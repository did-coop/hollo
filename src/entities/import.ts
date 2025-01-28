import { Readable } from "node:stream";
import {
  importActorProfile,
  validateExportStream,
} from "@interop/wallet-export-ts";
import CUUIDSHA256 from "cuuid-sha-256";
import { and, eq } from "drizzle-orm";
import { canonicalize } from "json-canonicalize";
import db from "../db";
import * as schema from "../schema";
import type { Uuid } from "../uuid";

export class AccountImporter {
  actorId: ActorIdType;

  constructor(actorId: ActorIdType) {
    this.actorId = actorId;
  }

  async importData(tarBuffer: Buffer) {
    const importStream = () => Readable.from(tarBuffer);
    const validateStream = () => Readable.from(tarBuffer);
    const importedData = await importActorProfile(importStream());
    console.log("🚀 ~ AccountImporter ~ importData ~ importedData:", importedData)

    try {
      const validationResult = await validateExportStream(validateStream());
      // if (!validationResult.valid) {
      //   throw new Error("Invalid export stream");
      // }
      console.log(
        "🚀 ~ AccountImporter ~ importData ~ validationResult:",
        validationResult,
      );
      await this.importIfExists(
        importedData,
        "activitypub/actor.json",
        this.importAccount.bind(this),
      );
      await this.importOrderedItems(
        importedData,
        "activitypub/outbox.json",
        this.importOutbox.bind(this),
      );
      // await this.importOrderedItems(
      //   importedData,
      //   "activitypub/likes.json",
      //   this.importLike.bind(this),
      // );
      // await this.importOrderedItems(
      //   importedData,
      //   "activitypub/blocked_accounts.json",
      //   this.importBlock.bind(this),
      // );
      // await this.importOrderedItems(
      //   importedData,
      //   "activitypub/muted_accounts.json",
      //   this.importMute.bind(this),
      // );
      // await this.importOrderedItems(
      //   importedData,
      //   "activitypub/followers.json",
      //   this.importFollower.bind(this),
      // );
      // await this.importOrderedItems(
      //   importedData,
      //   "activitypub/following.json",
      //   this.importFollowing.bind(this),
      // );
      // await this.importOrderedItems(
      //   importedData,
      //   "activitypub/bookmarks.json",
      //   this.importBookmark.bind(this),
      // );
      // await this.importCollection(
      //   importedData,
      //   "activitypub/lists.json",
      //   this.importList.bind(this),
      // );
    } catch (error) {
      console.error("Error importing account profile:", { error });
      throw error;
    }
  }

  async importIfExists<T>(
    data: Record<string, unknown>,
    key: string,
    handler: (item: T) => Promise<void>,
  ) {
    try {
      await handler(data[key] as T);
    } catch (error) {
      console.warn(`Failed to import key ${key}:`, error);
      throw error; // Or handle this more gracefully if partial success is acceptable
    }
  }

  async importCollection<T>(
    data: Record<string, unknown>,
    key: string,
    handler: (item: T) => Promise<void>,
  ) {
    if (Array.isArray(data[key])) {
      await Promise.all((data[key] as T[]).map(handler));
    }
  }

  async importOrderedItems<T>(
    data: Record<string, unknown>,
    key: string,
    handler: (item: T) => Promise<void>,
  ) {
    if (
      key in data &&
      typeof data[key] === "object" &&
      data[key] !== null &&
      "orderedItems" in (data[key] as Record<string, unknown>)
    ) {
      const orderedItems = (data[key] as { orderedItems: T[] }).orderedItems;
      if (!Array.isArray(orderedItems)) {
        throw new Error("orderedItems is not an array");
      }
      if (orderedItems.length === 0) {
        return;
      }
      await Promise.all(orderedItems.map(handler));
    }
  }

  async importAccount(profileData: ActorProfile) {
    // Generate a new account ID using cuuid
    const accountDataCanonical = canonicalize({
      url: profileData.url,
      handle: profileData.acct,
      name: profileData.display_name,
    });

    const cuuid = new CUUIDSHA256({
      namespace: profileData.id,
      name: accountDataCanonical,
    });

    const newAccountId = await cuuid.toString();
    console.log(
      "🚀 ~ AccountImporter ~ importAccount ~ newAccountId:",
      newAccountId,
    );

    // Check if the new account ID already exists
    const isExistingAccount = await db.query.accounts.findFirst({
      where: eq(schema.accounts.id, newAccountId),
    });
    if (isExistingAccount) {
      console.warn(`Account with ID ${newAccountId} already exists, skipping`);
      return;
    }

    const instanceHost = new URL(profileData.url).hostname;

    await db.transaction(async (tx) => {
      const existingInstance = await tx.query.instances.findFirst({
        where: eq(schema.instances.host, instanceHost),
      });
      if (!existingInstance) {
        await tx.insert(schema.instances).values({ host: instanceHost });
      }

      const existingOwner = await tx
        .select()
        .from(schema.accountOwners)
        .where(eq(schema.accountOwners.id, this.actorId))
        .then((rows) => rows[0]);

      if (!existingOwner) {
        throw new Error(`Account owner not found: ${this.actorId}`);
      }

      const oldAccount = await tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, this.actorId))
        .then((rows) => rows[0]);
      console.log(
        "🚀 ~ AccountImporter ~ awaitdb.transaction ~ oldAccount:",
        oldAccount,
      );

      await tx
        .delete(schema.accounts)
        .where(eq(schema.accounts.id, this.actorId));

      await tx
        .delete(schema.accountOwners)
        .where(eq(schema.accountOwners.id, this.actorId));

      // Update the old account's ID to the new account ID
      oldAccount.id = newAccountId;
      await tx.insert(schema.accounts).values(oldAccount);

      const ownerData = {
        id: newAccountId,
        handle: existingOwner.handle,
        rsaPrivateKeyJwk: existingOwner.rsaPrivateKeyJwk,
        rsaPublicKeyJwk: existingOwner.rsaPublicKeyJwk,
        ed25519PrivateKeyJwk: existingOwner.ed25519PrivateKeyJwk,
        ed25519PublicKeyJwk: existingOwner.ed25519PublicKeyJwk,
        fields: existingOwner.fields,
        bio: existingOwner.bio,
        followedTags: existingOwner.followedTags,
        visibility: existingOwner.visibility,
        language: existingOwner.language,
      };

      await tx.insert(schema.accountOwners).values(ownerData);
    });

    // Update the actorId to the new account ID
    this.actorId = newAccountId;
    console.log(
      "🚀 ~ AccountImporter ~ importAccount ~ this.actorId: [1]",
      this.actorId,
    );
  }

  async importOutbox(activity: any) {
    try {
      // Validate the activity object
      if (!activity.object) {
        return;
      }

      const post = activity.object; // The `Note` object inside the `Create` activity
      console.log("🚀 ~ AccountImporter ~ importOutbox ~ post:", post)

      // Validate the post object
      if (!post.id || !post.type || !post.published || !post.content) {
        console.error("Skipping post due to missing required fields:", post);
        return;
      }

      // Generate a new post ID using cuuid
      const postDataCanonical = canonicalize({
        uri: post.id, // Use post.id as the unique identifier
        createdAt: post.published,
        accountId: this.actorId, // Use the new account ID
      });

      const cuuid = new CUUIDSHA256({
        namespace: this.actorId,
        name: postDataCanonical,
      });

      const newPostId = await cuuid.toString();

      // Check if the post already exists
      const isExistingPost = await db.query.posts.findFirst({
        where: eq(schema.posts.iri, post.id), // Check by post.id (iri)
      });

      if (isExistingPost) {
        console.warn(
          `Post with ID ${post.id} already exists, updating instead of skipping`,
        );
      }

      const postData = {
        id: newPostId,
        iri: post.id as schema.PostType, // Use post.id as the unique identifier
        type: post.type,
        accountId: this.actorId,
        createdAt: new Date(post.published),
        replyTargetId: post.inReplyTo
          ? (new URL(post.inReplyTo).pathname.split("/").pop() as Uuid | null)
          : null, // Extract ID from inReplyTo URL
        sharingId: null, // Assuming no direct sharing reference in the sample
        quoteTargetId: null, // Assuming no quote target in the sample
        visibility: "public" as const, // Defaulting to 'public'
        summary: post.summary || "", // Use `summary` if available
        contentHtml: post.content || "", // Raw HTML content
        content: "", // Plain text extraction (if required later)
        pollId: null, // Assuming no poll data in the sample
        language: post.contentMap?.en ? "en" : "und", // Infer language
        // @ts-ignore
        tags: post.tags?.reduce((acc, tag) => {
          acc[tag.name] = tag.href;
          return acc;
        }, {} as Record<string, string>) || {}, // Convert tags array to a JSON object
        emojis: {}, // Assuming no emojis provided in the sample
        sensitive: post.sensitive || false, // Use `post.sensitive` if available
        url: post.url || post.id, // Use `url` or fallback to `id`
        previewCard: null, // Assuming no preview card in the sample
        repliesCount: post.replies?.totalItems || 0, // Replies count
        sharesCount: post.shares?.totalItems || 0, // Shares count
        likesCount: post.likes?.totalItems || 0, // Likes count
        idempotenceKey: null, // Assuming no idempotenceKey in the sample
        published: new Date(post.published), // Use `published` as timestamp
        updated: new Date(), // Current timestamp for updates
        favourited: false, // Default value
        reblogged: false, // Default value
        muted: false, // Default value
        bookmarked: false, // Default value
        pinned: false, // Default value
      };

      // Insert or update the post
      await db
        .insert(schema.posts)
        .values(postData)
        .onConflictDoUpdate({
          target: schema.posts.iri,
          set: {
            accountId: this.actorId,
            contentHtml: post.content,
          },
        });

      console.log(
        "🚀 ~ AccountImporter ~ importOutbox ~ post imported/updated successfully:",
        newPostId,
      );
    } catch (error) {
      console.error("Error importing post:", { error });
      throw error; // Re-throw the error to trigger transaction rollback
    }
  }

  async importBookmark(bookmark: Bookmark) {
    const existingBookmark = await db.query.bookmarks.findFirst({
      where: and(
        eq(schema.bookmarks.accountOwnerId, this.actorId),
        eq(schema.bookmarks.postId, bookmark.postId),
      ),
    });

    if (existingBookmark) {
      await db
        .update(schema.bookmarks)
        .set({
          created: new Date(bookmark.created),
          postId: bookmark.postId,
          accountOwnerId: this.actorId,
        })
        .where(
          and(
            eq(schema.bookmarks.accountOwnerId, this.actorId),
            eq(schema.bookmarks.postId, bookmark.postId),
          ),
        );
    } else {
      await db.insert(schema.bookmarks).values({
        created: new Date(bookmark.created),
        postId: bookmark.postId,
        accountOwnerId: this.actorId,
      });
    }
  }
  async importFollower(follower: Follower) {
    try {
      const existingFollow = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, this.actorId),
          eq(schema.follows.followingId, follower.followingId),
        ),
      });

      const followData = {
        created: new Date(follower.created),
        approved: follower.approved ? new Date(follower.approved) : null,
        iri: follower.iri,
        shares: follower.shares,
        notify: follower.notify,
        languages: follower.languages,
        followerId: this.actorId,
        followingId: follower.followingId,
      };

      if (existingFollow) {
        await db
          .update(schema.follows)
          .set(followData)
          .where(
            and(
              eq(schema.follows.followerId, this.actorId),
              eq(schema.follows.followingId, follower.followingId),
            ),
          );
      } else {
        await db.insert(schema.follows).values(followData);
      }
    } catch (error) {
      console.error(
        `Failed to import follow relationship for follower ID: ${this.actorId} following ID: ${follower.followingId}`,
        error,
      );
    }
  }

  async importFollowing(following: Follower) {
    try {
      const existingFollow = await db.query.follows.findFirst({
        where: and(
          eq(schema.follows.followerId, following.followerId),
          eq(schema.follows.followingId, this.actorId),
        ),
      });

      const followData = {
        created: new Date(following.created),
        approved: following.approved ? new Date(following.approved) : null,
        iri: following.iri,
        shares: following.shares,
        notify: following.notify,
        languages: following.languages,
        followerId: following.followerId,
        followingId: this.actorId,
      };

      if (existingFollow) {
        await db
          .update(schema.follows)
          .set(followData)
          .where(
            and(
              eq(schema.follows.followerId, following.followerId),
              eq(schema.follows.followingId, this.actorId),
            ),
          );
      } else {
        await db.insert(schema.follows).values(followData);
      }
    } catch (error) {
      console.error(
        `Failed to import follow relationship for follower ID: ${following.followerId} following ID: ${this.actorId}`,
        error,
      );
      throw error;
    }
  }

  async importList(list: List) {
    const existingList = await db.query.lists.findFirst({
      where: eq(schema.lists.id, list.id),
    });

    const listData = {
      title: list.title,
      repliesPolicy: list.replies_policy,
      exclusive: list.exclusive,
      accountOwnerId: this.actorId,
    };

    if (existingList) {
      await db
        .update(schema.lists)
        .set(listData)
        .where(eq(schema.lists.id, list.id));
    } else {
      await db.insert(schema.lists).values({ id: list.id, ...listData });
    }
  }

  async importLike(like: Like) {
    const existingLike = await db.query.likes.findFirst({
      where: and(
        eq(schema.likes.accountId, this.actorId),
        eq(schema.likes.postId, like.postId),
      ),
    });

    const likeData = {
      created: new Date(like.created),
      postId: like.postId,
      accountId: this.actorId,
    };

    if (existingLike) {
      await db
        .update(schema.likes)
        .set(likeData)
        .where(
          and(
            eq(schema.likes.accountId, this.actorId),
            eq(schema.likes.postId, like.postId),
          ),
        );
    } else {
      await db.insert(schema.likes).values(likeData);
    }
  }

  async importBlock(block: Block) {
    const existingBlock = await db.query.blocks.findFirst({
      where: and(
        eq(schema.blocks.accountId, this.actorId),
        eq(schema.blocks.blockedAccountId, block.blockedAccountId),
      ),
    });

    const blockData = {
      created: new Date(block.created),
      accountId: this.actorId,
      blockedAccountId: block.blockedAccountId,
    };

    if (existingBlock) {
      await db
        .update(schema.blocks)
        .set(blockData)
        .where(
          and(
            eq(schema.blocks.accountId, this.actorId),
            eq(schema.blocks.blockedAccountId, block.blockedAccountId),
          ),
        );
    } else {
      await db.insert(schema.blocks).values(blockData);
    }
  }

  async importMute(mute: Mute) {
    const existingMute = await db.query.mutes.findFirst({
      where: and(
        eq(schema.mutes.accountId, this.actorId),
        eq(schema.mutes.mutedAccountId, mute.mutedAccountId),
      ),
    });

    const muteData = {
      id: mute.id,
      created: new Date(mute.created),
      notifications: mute.notifications,
      duration: mute.duration,
      accountId: this.actorId,
      mutedAccountId: mute.mutedAccountId,
    };

    if (existingMute) {
      await db
        .update(schema.mutes)
        .set(muteData)
        .where(
          and(
            eq(schema.mutes.accountId, this.actorId),
            eq(schema.mutes.mutedAccountId, mute.mutedAccountId),
          ),
        );
    } else {
      await db.insert(schema.mutes).values(muteData);
    }
  }
}

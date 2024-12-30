import { importActorProfile } from "@interop/wallet-export-ts";
import { and, eq } from "drizzle-orm";
import db from "../db";
import * as schema from "../schema";
import CUUIDSHA256 from "cuuid-sha-256";
import { canonicalize } from "json-canonicalize";

const NAMESPACE = "bd97808c-95bb-8be7-84e9-89db07656caf";

export class AccountImporter {
  actorId: string;

  constructor(actorId: string) {
    this.actorId = actorId;
  }

  async importData(tarBuffer: Buffer) {
    const importedData = await importActorProfile(tarBuffer);

    try {
      await this.importIfExists(
        importedData,
        "activitypub/actor.json",
        this.importAccount.bind(this),
      );
      await this.importCollection(
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
    const accountDataCanonical = canonicalize({
      url: profileData.url,
      handle: profileData.acct,
      name: profileData.display_name,
    });

    const cuuid = new CUUIDSHA256({
      namespace: NAMESPACE,
      name: accountDataCanonical,
    });

    const newActorId = await cuuid.toString();
    const isExistingAccount = await db.query.accounts.findFirst({
      where: eq(schema.accounts.id, newActorId),
    });
    if (isExistingAccount) {
      console.warn(`Account with ID ${newActorId} already exists, skipping`);
      return;
    }

    let instanceHost = new URL(profileData.url).hostname;

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

      await tx
        .delete(schema.bookmarks)
        .where(eq(schema.bookmarks.accountOwnerId, this.actorId));
      await tx
        .delete(schema.accounts)
        .where(eq(schema.accounts.id, this.actorId));

      const accountData = {
        id: newActorId,
        iri: profileData.url,
        type: profileData.type,
        handle: profileData.acct,
        name: profileData.display_name,
        protected: profileData.locked,
        bioHtml: profileData.note,
        url: profileData.url,
        avatarUrl: profileData.avatar,
        coverUrl: profileData.header,
        inboxUrl: `${profileData.url}/inbox`,
        followersCount: profileData.followers_count,
        followingCount: profileData.following_count,
        postsCount: profileData.statuses_count,
        fieldHtmls: profileData.fields.reduce(
          (acc, f) => ({ ...acc, [f.name]: f.value }),
          {},
        ),
        emojis: profileData.emojis.reduce(
          (acc, e) => ({ ...acc, [e.shortcode]: e.url }),
          {},
        ),
        published: new Date(profileData.created_at),
        instanceHost,
      };

      await tx
        .delete(schema.accountOwners)
        .where(eq(schema.accountOwners.id, this.actorId));
      await tx.insert(schema.accounts).values(accountData);

      const ownerData = {
        id: newActorId,
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
    this.actorId = newActorId;
  }

  async importOutbox(post: Post) {
    const postDataCanonical = canonicalize({
      uri: post.uri,
      createdAt: post.created_at,
      accountId: this.actorId,
    });

    const cuuid = new CUUIDSHA256({
      namespace: NAMESPACE,
      name: postDataCanonical,
    });

    const newMessageId = await cuuid.toString();
    const isExistingPost = await db.query.posts.findFirst({
      where: eq(schema.posts.id, newMessageId),
    });
    if (isExistingPost) {
      console.warn(`Post with ID ${newMessageId} already exists, skipping`);
      return;
    }

    const postData = {
      id: newMessageId,
      iri: post.uri,
      type: post.type,
      accountId: this.actorId,
      createdAt: new Date(post.created_at),
      inReplyToId: post.in_reply_to_id,
      sensitive: post.sensitive,
      spoilerText: post.spoiler_text,
      visibility: post.visibility,
      language: post.language,
      url: post.url,
      repliesCount: post.replies_count,
      reblogsCount: post.reblogs_count,
      favouritesCount: post.favourites_count,
      favourited: post.favourited,
      reblogged: post.reblogged,
      muted: post.muted,
      bookmarked: post.bookmarked,
      pinned: post.pinned,
      contentHtml: post.content,
      quoteId: post.quote_id,
    };

    // Add the new post
    // curent state => outbox = the existing outbox + the imported ones with diffrent ids
    await db.insert(schema.posts).values(postData).onConflictDoNothing({
      target: schema.posts.iri,
    });
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

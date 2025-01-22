import { exportActorProfile } from "@interop/wallet-export-ts";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import db from "../db";
import * as schema from "../schema";
import { serializeAccount } from "./account";
import { serializeList } from "./list";
import { getPostRelations } from "./status";
import { Activity, lookupObject } from "@fedify/fedify";


const homeUrl = process.env["HOME_URL"] || "http://localhost:3000";

export const serializePost = (post: Post, actor: {id: ActorIdType}) => {
  const note = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: new URL(post.iri),
    type: "Note",
    summary: post.summary || null,
    inReplyTo: post.replyTargetId ? new URL(`${homeUrl}/posts/${post.replyTargetId}`) : null,
    published: post.published?.toISOString() || new Date().toISOString(),
    url: post.url ? new URL(post.url) : new URL(`${homeUrl}/posts/${post.id}`),
    attributedTo: new URL(`${homeUrl}/accounts/${actor.id}`),
    to: [new URL("https://www.w3.org/ns/activitystreams#Public")],
    cc: [new URL(`${homeUrl}/accounts/${actor.id}/followers`)],
    sensitive: post.sensitive,
    atomUri: new URL(post.iri),
    inReplyToAtomUri: post.replyTargetId ? new URL(`${homeUrl}/posts/${post.replyTargetId}`) : null,
    conversation: `tag:${new URL(homeUrl).hostname},${post.published?.toISOString()}:objectId=${post.id}:objectType=Conversation`,
    content: post.contentHtml || post.content || "",
    contentMap: {
      en: post.contentHtml || post.content || "",
    },
    attachment: post.media?.map((media: any) => ({
      type: "Document",
      mediaType: media.contentType,
      url: new URL(media.url),
    })) || [],
    tag: post.tags ? Object.entries(post.tags).map(([name, href]) => ({
      type: "Hashtag",
      href: new URL(href),
      name: `#${name}`,
    })) : [],
    replies: {
      id: new URL(`${post.iri}/replies`),
      type: "Collection",
      totalItems: post.repliesCount,
    },
    likes: {
      id: new URL(`${post.iri}/likes`),
      type: "Collection",
      totalItems: post.likesCount,
    },
    shares: {
      id: new URL(`${post.iri}/shares`),
      type: "Collection",
      totalItems: post.sharesCount,
    },
  };

  const activity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: new URL(`${post.iri}/activity`),
    type: "Create",
    actor: new URL(`${homeUrl}/accounts/${actor.id}`),
    published: post.published?.toISOString() || new Date().toISOString(),
    to: note.to,
    cc: note.cc,
    object: note,
  };

  return activity;
}

async function fetchOutbox(actor: any) {
  const outbox = await actor.getOutbox();
  console.log("🚀 ~ fetchOutbox ~ outbox:", outbox)
  if (!outbox) return null;

  const items = await outbox.getItems();
  console.log("🚀 ~ fetchOutbox ~ items:", items)
  const activities: Activity[] = [];
  for (const activity of items) {
    if (activity instanceof Activity) {
      activities.push(activity);
    }
  }

  return activities;
}

async function generateOutbox(actor: any, baseUrl: string | URL) {
  const activities = await fetchOutbox(actor);
  console.log("🚀 ~ generateOutbox ~ activities:", activities)
  if (!activities) return null;

  const outbox = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      {
        // Additional context definitions
      },
    ],
    id: new URL("/outbox.json", baseUrl).toString(),
    type: "OrderedCollection",
    totalItems: activities.length,
    orderedItems: await Promise.all(
      activities.map(async (activity) => {
        // Fetch the full object associated with the activity
        const object = await activity.getObject();

        return {
          id: activity.id?.toString(),
          type: "OrderedCollection", // Use `activity.typeId`
          actor: activity.actorId?.toString(),
          published: activity.published?.toString(),
          to: object?.toIds?.map((to: URL) => to.toString()), // Use `object.to`
          cc: object?.ccIds?.map((cc: URL) => cc.toString()), // Use `object.cc`
          object: object?.id?.toString(), // Use `object.id`
        };
      })
    ),
  };

  return outbox;
}

// Account Exporter class to handle data loading and serialization
export class AccountExporter {
  actorId: ActorIdType;

  constructor(actorId: ActorIdType) {
    if (!actorId) {
      throw new Error("Invalid actorId");
    }
    this.actorId = actorId;
  }

  async loadAccount() {
    return db.query.accounts.findFirst({
      where: eq(schema.accounts.id, this.actorId),
      with: { owner: true },
    });
  }

  async loadPosts() {
    return db.query.posts.findMany({
      where: eq(schema.posts.accountId, this.actorId),
      with: getPostRelations(this.actorId), // Fetch related data using getPostRelations
    });
  }

  async loadFollows(type: "following" | "followers") {
    const column = type === "following" ? "followingId" : "followerId";

    return db.query.follows.findMany({
      where: eq(schema.follows[column], this.actorId),
    });
  }

  async loadBookmarks() {
    return db.query.bookmarks.findMany({
      where: eq(schema.bookmarks.accountOwnerId, this.actorId),
    });
  }

  async loadLists() {
    return db.query.lists.findMany({
      where: eq(schema.lists.accountOwnerId, this.actorId),
    });
  }

  serializeBookmarks(bookmarks: schema.Bookmark[]) {
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "bookmarks.json",
      type: "OrderedCollection",
      orderedItems: bookmarks.map((bookmark) => bookmark.postId),
    };
  }
  private normalizeUrl(path: string): string {
    const base = homeUrl.endsWith("/") ? homeUrl : `${homeUrl}/`;
    return new URL(path, base).toString();
  }

  serializeFollowing(followingAccounts: schema.Follow[]) {
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "following_accounts.json",
      type: "OrderedCollection",
      orderedItems: followingAccounts.map((account) => ({
        followingId: this.actorId,
        account: this.normalizeUrl(`accounts/${account.followingId}`),
        created: new Date(account.created),
        approved: account.approved ? new Date(account.approved) : null,
        iri: account.iri,
        shares: account.shares,
        notify: account.notify,
        languages: account.languages,
        followerId: account.followerId,
      })),
    };
  }

  serializeFollowers(followers: schema.Follow[]) {
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "followers.json",
      type: "OrderedCollection",
      orderedItems: followers.map((follower) => ({
        account: this.normalizeUrl(`accounts/${follower.followerId}`),
        created: new Date(follower.created),
        approved: follower.approved ? new Date(follower.approved) : null,
        iri: follower.iri,
        shares: follower.shares,
        notify: follower.notify,
        languages: follower.languages,
        followerId: this.actorId,
        followingId: follower.followingId,
      })),
    };
  }

  async exportData(c: Context) {
    try {
      const account = await this.loadAccount();
      if (!account) return c.json({ error: "Actor not found" }, 404);

      const postsData = await this.loadPosts();
      console.log("🚀 ~ AccountExporter ~ exportData ~ postsData:", postsData)
        
const actor = await lookupObject(account.iri);

const outbox = await generateOutbox(actor, new URL(homeUrl));

    console.log("🚀 ~ AccountExporter ~ exportData ~ outbox:", outbox)

      const lists = await this.loadLists();
      const serializedLists = lists.map((list) => serializeList(list));

      const followers = await this.loadFollows("followers");
      const serializedFollowers = this.serializeFollowers(followers);

      const followingAccounts = await this.loadFollows("following");
      const serializedFollowing = this.serializeFollowing(followingAccounts);

      const bookmarks = await this.loadBookmarks();
      const serializedBookmarks = this.serializeBookmarks(bookmarks);

      // Initialize export stream
      const { addMediaFile, finalize } = await exportActorProfile({
        actorProfile: serializeAccount(
          { ...account, successor: null },
          c.req.url,
        ),
        outbox: outbox,
        lists: serializedLists,
        followers: serializedFollowers,
        followingAccounts: serializedFollowing,
        bookmarks: serializedBookmarks,
      });

      // Add media files
      const mediaPromises = postsData.flatMap((post) => {
        if (!post.media) return [];

        return post.media.map(async (media: { id: string; url: string }) => {
          try {
            const mediaRecord = await this.downloadMedia(media.url);
            if (!mediaRecord) return;

            const extension = mediaRecord.contentType?.split("/")[1];
            const fileName = `${media.id}.${extension}`;

            // Add media file to the export stream
            addMediaFile(fileName, mediaRecord.buffer, mediaRecord.contentType);
          } catch (error) {
            console.error(`Error downloading media: ${media.id}`, error);
          }
        });
      });

      // Wait for all media downloads to complete
      await Promise.all(mediaPromises);

      const exportTarballStream = finalize();

      return c.body(exportTarballStream, 200, {
        "Content-Type": "application/x-tar",
        "Content-Disposition": `attachment; filename="account_export_${encodeURIComponent(
          this.actorId,
        )}.tar"`,
      });
    } catch (e) {
      console.error(e);
      return c.json({ error: "Internal server error occurred" }, 500);
    }
  }

  private async downloadMedia(
    mediaUrl: string,
  ): Promise<null | { buffer: ArrayBuffer; contentType: string }> {
    if (!mediaUrl) {
      return null;
    }

    try {
      const response = await fetch(mediaUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.statusText}`);
      }

      return {
        buffer: await response.arrayBuffer(),
        contentType: response.headers.get("Content-Type") || "application/bin",
      }; // Binary data
    } catch (error) {
      console.error(`Error downloading media from ${mediaUrl}:`, error);
      return null;
    }
  }
}

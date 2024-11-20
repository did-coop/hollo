import { exportActorProfile } from "@interop/wallet-export-ts";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import db from "../db";
import * as schema from "../schema";
import { serializeAccount } from "./account";
import { serializeList } from "./list";
import { getPostRelations, serializePost } from "./status";

// Account Exporter class to handle data loading and serialization
export class AccountExporter {
  actorId: string;

  constructor(actorId: string) {
    if (!actorId) {
      throw new Error("Invalid actorId");
    }
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

  async loadLikes() {
    return db.query.likes.findMany({
      where: eq(schema.likes.accountId, this.actorId),
    });
  }

  async loadBloks() {
    return db.query.blocks.findMany({
      where: eq(schema.blocks.accountId, this.actorId),
    });
  }

  async loadMutes() {
    return db.query.mutes.findMany({
      where: eq(schema.mutes.accountId, this.actorId),
    });
  }

  serializeBookmarks(bookmarks: schema.Bookmark[]) {
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "bookmarks.json",
      type: "OrderedCollection",
      orderedItems: bookmarks,
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
        account: this.normalizeUrl(`accounts/${account.followingId}`),
        showBoosts: account.shares,
        notifyOnNewPosts: account.notify,
        language: account.languages ?? null,
        language: account.languages ?? null,
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
        account: this.normalizeUrl(`accounts/${follower.followerId}`),
        followedSince: follower.created,
        language: follower.languages,
      })),
    };
  }

  serializeMutes(mutes: schema.Mute[]) {
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "mutes.json",
      type: "OrderedCollection",
      orderedItems: mutes.map((mute) => ({
        id: mute.id,
        accountId: mute.accountId,
        mutedAccountId: mute.mutedAccountId,
        notifications: mute.notifications,
        duration: mute.duration,
        created: mute.created,
      })),
    };
  }

  serializeBlocks(blocks: schema.Block[]) {
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "blocks.json",
      type: "OrderedCollection",
      orderedItems: blocks.map((block) => ({
        accountId: block.accountId,
        blockedAccountId: block.blockedAccountId,
        created: block.created,
      })),
    };
  }

  serializeLikes(likes: schema.Like[]) {
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "likes.json",
      type: "OrderedCollection",
      orderedItems: likes.map((like) => ({
        postId: like.postId,
        accountId: like.accountId,
        created: like.created,
      })),
    };
  }

  async exportData(c: Context) {
    try {
      const account = await this.loadAccount();
      if (!account) return c.json({ error: "Actor not found" }, 404);

      const postsData = await this.loadPosts();
      const serializedPosts = postsData.map((post) =>
        serializePost(post, { id: account.owner.id }, c.req.url),
      );

      const lists = await this.loadLists();
      const serializedLists = lists.map((list) => serializeList(list));

      const followers = await this.loadFollows("followers");
      const serializedFollowers = this.serializeFollowers(followers);

      const followingAccounts = await this.loadFollows("following");
      const serializedFollowing = this.serializeFollowing(followingAccounts);

    const bookmarks = await this.loadBookmarks();
    const serializedBookmarks = this.serializeBookmarks(bookmarks);

    const mutes = await this.loadMutes();
    const serializedMutes = this.serializeMutes(mutes);

    const blocks = await this.loadBloks();
    const serializedBlocks = this.serializeBlocks(blocks);

    const likes = await this.loadLikes();
    const serializedLikes = this.serializeLikes(likes);

    const exportTarballStream = exportActorProfile({
      actorProfile: serializeAccount(
        { ...account, successor: null },
        c.req.url,
      ),
      outbox: serializedPosts,
      lists: serializedLists,
      followers: serializedFollowers,
      followingAccounts: serializedFollowing,
      bookmarks: serializedBookmarks,
      mutedAccounts: serializedMutes,
      blockedAccounts: serializedBlocks,
      likes: serializedLikes,
    });

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

// Define an interface for ActorProfile
type ActorIdType = `${string}-${string}-${string}-${string}-${string}`;

interface ActorProfile {
  id: ActorIdType;
  type:
    | SQL<unknown>
    | "Application"
    | "Group"
    | "Organization"
    | "Person"
    | "Service";
  acct: string; // Maps to `handle` in the schema
  display_name: string; // Maps to `name` in the schema
  locked: boolean; // Maps to `protected` in the schema
  bot: boolean;
  created_at: string; // Corresponds to `published` in the schema
  note: string; // Maps to `bioHtml`
  url: string;
  avatar: string; // Maps to `avatarUrl`
  avatar_static: string; // Static version of the avatar URL
  header: string; // Maps to `coverUrl`
  header_static: string; // Static version of the header URL
  followers_count: number; // Maps to `followersCount`
  following_count: number; // Maps to `followingCount`
  statuses_count: number; // Maps to `postsCount`
  emojis: Array<{ shortcode: string; url: string; static_url: string }>;
  fields: Array<{ name: string; value: string }>;
  moved: null | string; // Could correspond to `successorId` if account moved
  last_status_at: null | string; // Timestamp of the last status update
}

// Define an interface for a Post
interface Post {
  id: string;
  iri: string;
  type: string;
  accountId: string;
  applicationId: string | null; // Allow null
  replyTargetId?: string | null;
  sharingId?: string | null;
  quoteTargetId?: `${string}-${string}-${string}-${string}-${string}` | null;
  visibility: string;
  summary?: string | null;
  contentHtml?: string | null;
  content?: string | null;
  pollId?: string | null;
  language?: string | null;
  tags: Record<string, string>;
  emojis: Record<string, string>;
  sensitive: boolean;
  url?: string | null;
  previewCard?: any | null;
  repliesCount: number;
  sharesCount: number;
  likesCount: number;
  idempotenceKey?: string;
  published?: Date | null;
  updated: Date;
  media?: Array<{ id: string; url: string; contentType: string }> | null;
}

// Define an interface for FollowersData
interface Follower {
  followerId: ActorIdType;
  followingId: ActorIdType;
  shares: boolean;
  notify: boolean;
  languages: string[];
  created: StringIterator;
  approved: Date | SQL<unknown> | null | undefined;
  iri: string;
}
interface FollowersData {
  "@context": string;
  id: ActorIdType;
  type: string;
  orderedItems: Follwer[];
}

// Define an interface for BookmarksData
interface Bookmark {
  postId: ActorIdType;
  accountOwnerId: string;
  created: Date | SQL<unknown>;
}
interface BookmarksData {
  "@context": string;
  id: ActorIdType;
  type: string;
  orderedItems: Bookmark;
}

interface List {
  id: ActorIdType;
  title: string;
  replies_policy: "none" | "list" | "followed";
  exclusive: boolean;
}

interface Mute {
  id: ActorIdType;
  accountId: ActorIdType;
  mutedAccountId: ActorIdType;
  notifications: boolean;
  duration?: string | null;
  created: string;
}

interface Block {
  accountId: ActorIdType;
  blockedAccountId: ActorIdType;
  created: string;
}

interface Like {
  postId: ActorIdType;
  accountId: ActorIdType;
  created: Date;
}

interface Media {
  id: ActorIdType;
  postId?: ActorIdType | null;
  type: string;
  url: string;
  width: number;
  height: number;
  description?: string | null;
  thumbnailType: string;
  thumbnailUrl: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  created: string;
}

import  { Activity } from "@fedify/fedify";
import { iterateCollection } from "../federation/collection";


// Helper to get tags as an array
async function getTagsAsArray(object: any): Promise<Array<{ type: string; href: string; name: string }>> {
  const tags = [];
  for await (const tag of object.getTags()) {
    tags.push({
      type: tag.typeId?.toString(), // e.g., "Hashtag"
      href: tag.href?.toString(),   // e.g., "https://social.tchncs.de/tags/foss"
      name: tag.name                // e.g., "#foss"
    });
  }
  return tags;
}

// Helper to get to as an array
async function getToAsArray(object: any): Promise<string[]> {
  const to = [];
  for await (const item of object.getTos()) {
    to.push(item.id.toString());
  }
  return to;
}

// Helper to get cc as an array
async function getCcAsArray(object: any): Promise<string[]> {
  const cc = [];
  for await (const item of object.getCcs()) {
    cc.push(item.id?.toString());
  }
  return cc;
}

// Helper to get replies as an array
async function getRepliesAsArray(object: any): Promise<Array<{ id: string; type: string }>> {
  const replies = [];
  for await (const reply of object.getReplies()) {
    replies.push({
      id: reply.id?.toString(),
      type: reply.typeId?.toString(),
    });
  }
  return replies;
}

// Helper to get shares as an array
async function getSharesAsArray(object: any): Promise<Array<{ id: string; type: string }>> {
  const shares = [];
  for await (const share of object.getShares()) {
    shares.push({
      id: share.id?.toString(),
      type: share.typeId?.toString(),
    });
  }
  return shares;
}

// Helper to get likes as an array
async function getLikesAsArray(object: any): Promise<Array<{ id: string; type: string }>> {
  const likes = [];
  for await (const like of object.getLikes()) {
    likes.push({
      id: like.id?.toString(),
      type: like.typeId?.toString(),
    });
  }
  return likes;
}

// Helper to get attachments as an array
async function getAttachmentsAsArray(object: any): Promise<Array<{ id: string; type: string }>> {
  const attachments = [];
  for await (const attachment of object.getAttachments()) {
    attachments.push({
      id: attachment.id?.toString(),
      type: attachment.typeId?.toString(),
    });
  }
  return attachments;
}

async function fetchOutbox(actor: any) {
  const outbox = await actor.getOutbox();
  console.log("🚀 ~ fetchOutbox ~ outbox:", outbox);
  if (!outbox) return null;

  const activities: Activity[] = [];
  for await (const activity of iterateCollection(outbox)) {
    if (activity instanceof Activity) {
      activities.push(activity);
    }
  }

  console.log("🚀 ~ fetchOutbox ~ activities:", activities);
  return activities;
}

function safeToString(value: any): string | undefined {
  return value?.toString();
}

function cleanObject(obj: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

async function generateOutbox(actor: any, baseUrl: string | URL) {
  const activities = await fetchOutbox(actor);
  if (!activities) return null;

  const outbox = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    id: new URL("/outbox.json", baseUrl).toString(),
    type: "OrderedCollection",
    totalItems: activities.length,
    orderedItems: await Promise.all(
      activities.map(async (activity) => {
        const object = await activity.getObject();
        if (!object) return null; // Skip if object is null

        // Handle `to` field
        const to = await getToAsArray(object);

        // Handle `cc` field
        const cc = await getCcAsArray(object);

        // Handle `tags` field
        const tags = await getTagsAsArray(object);

        // Handle `replies` field
        const replies = await getRepliesAsArray(object);

        // Handle `shares` field
        const shares = await getSharesAsArray(object);

        // Handle `likes` field
        const likes = await getLikesAsArray(object);

        // Handle `attachments` field
        const attachments = await getAttachmentsAsArray(object);

        // Create the full object
        const fullObject = cleanObject({
          id: safeToString(object.id),
          type: safeToString(object.typeId),
          content: object.content,
          published: safeToString(object.published),
          url: safeToString(object.url),
          to: to.length > 0 ? to : undefined,
          cc: cc.length > 0 ? cc : undefined,
          tags: tags.length > 0 ? tags : undefined,
          replies: replies.length > 0 ? replies : undefined,
          shares: shares.length > 0 ? shares : undefined,
          likes: likes.length > 0 ? likes : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        });

        return cleanObject({
          id: safeToString(activity.id),
          type: "OrderedCollection",
          actor: safeToString(activity.actorId),
          published: safeToString(activity.published),
          to: activity.toIds,
          cc: activity.ccIds,
          object: fullObject,
        });
      })
    ).then((items) => items.filter(Boolean)), // Remove null entries
  };

  return outbox;
}

export {
  generateOutbox
}

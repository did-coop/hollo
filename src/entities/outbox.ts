import {
  Activity,
  type Actor,
  type Object as FedifyObject,
} from "@fedify/fedify";
import { iterateCollection } from "../federation/collection";

// Helper to get tags as an array
async function getTagsAsArray(
  object: FedifyObject,
): Promise<Array<{ type: string; href: string; name: string }>> {
  const tags = [];
  for await (const tag of object.getTags() as any) {
    tags.push({
      type: tag.id?.toString(),
      href: tag.href?.toString(),
      name: tag.name,
    });
  }
  return tags;
}

async function getRepliesAsArray(object: any): Promise<Array<{ id: string; type: string, totalItems: number }>> {
  if (!object?.getReplies) return [];
  const replies = [];
  for await (const reply of object.getReplies()) {
    const id = safeToString(reply.id);
    const type = safeToString(reply.typeId);
    if (id && type) {
      replies.push({
        id,
        type,
        totalItems: reply.totalItems,
      });
    }
  }
  return replies.filter((reply) => reply.id && reply.type); // Remove incomplete entries
}

async function fetchOutbox(actor: Actor) {
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

function safeToString(value: unknown): string | undefined {
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

async function generateOutbox(actor: Actor, baseUrl: string | URL) {
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
        console.log("🚀 ~ Processing activity:", activity);

        const object = await activity.getObject();
        console.log("🚀 ~ Retrieved object:", object);

        if (!object) {
          console.log("🚀 ~ Object is null, skipping activity");
          return null;
        }

        const replies = await object.getReplies();

        const to = object.toIds;
        const cc = object.ccIds;

        const tags = await getTagsAsArray(object);

        const fullObject = cleanObject({
          id: safeToString(object.id),
          type: safeToString(object.id),
          content: object.content,
          published: safeToString(object.published),
          url: safeToString(object.url),
          to: to.length > 0 ? to : undefined,
          cc: cc.length > 0 ? cc : undefined,
          tags: tags.length > 0 ? tags : undefined,
          replies: replies
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
      }),
    ).then((items) => items.filter(Boolean)), // Remove null entries
  };

  return outbox;
}

export { generateOutbox };

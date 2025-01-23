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
        console.log("🚀 ~ Processing activity:", activity);

        const object = await activity.getObject();
        console.log("🚀 ~ Retrieved object:", object);

        if (!object) {
          console.log("🚀 ~ Object is null, skipping activity");
          return null; // Skip if object is null
        }

        const to =  object.toIds;
        const cc = object.ccIds

        const tags = await getTagsAsArray(object);
        console.log("🚀 ~ Processed tags:", tags);

        const fullObject = cleanObject({
          id: safeToString(object.id),
          type: safeToString(object.id),
          content: object.content,
          published: safeToString(object.published),
          url: safeToString(object.url),
          to: to.length > 0 ? to : undefined,
          cc: cc.length > 0 ? cc : undefined,
          tags: tags.length > 0 ? tags : undefined,
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

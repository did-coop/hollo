// @ts-nocheck
import { faker } from '@faker-js/faker';
import { stringify } from 'flatted'; // For safe serialization
import { v4 as uuidv4 } from 'uuid';
import db from './db'; // Ensure correct Drizzle ORM setup

// Import models/tables from your schema
import {
  accountOwners,
  accounts,
  bookmarks,
  follows,
  likes,
  posts,
  reactions,
} from './schema';

// Global variables to store seeded data for linking
let accountData = [];
let accountOwnerData = [];
let postData = [];

// Helper function for batch insert with safe serialization
async function batchInsert(table, data, batchSize = 100) {
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize).map(record => {
      // Serialize JSON fields safely
      if (record.fieldHtmls) record.fieldHtmls = stringify(record.fieldHtmls);
      if (record.emojis) record.emojis = stringify(record.emojis);
      return record;
    });
    await db.insert(table).values(batch);
  }
}

// Seed accounts
async function seedAccounts() {
  accountData = Array.from({ length: 50 }).map(() => ({
    id: uuidv4(),
    iri: faker.internet.url(),
    type: faker.helpers.arrayElement(['Person', 'Organization', 'Service']),
    name: faker.person.fullName(), // Updated to use the new API
    handle: faker.internet.userName(),
    bioHtml: faker.lorem.paragraph(),
    url: faker.internet.url(),
    protected: faker.datatype.boolean(),
    avatarUrl: faker.image.avatar(),
    coverUrl: faker.image.url(),
    inboxUrl: faker.internet.url(),
    followersUrl: faker.internet.url(),
    sharedInboxUrl: faker.internet.url(),
    featuredUrl: faker.internet.url(),
    followingCount: faker.helpers.rangeToNumber({ min: 0, max: 500 }),
    followersCount: faker.helpers.rangeToNumber({ min: 0, max: 500 }),
    postsCount: faker.helpers.rangeToNumber({ min: 0, max: 500 }),
    fieldHtmls: { description: faker.lorem.sentence() },
    emojis: { smile: '😀' },
    sensitive: faker.datatype.boolean(),
    published: faker.date.past(),
    updated: faker.date.recent(),
  }));

  await batchInsert(accounts, accountData);
  console.log('Accounts seeded.');
}

// Seed account owners
async function seedAccountOwners() {
  accountOwnerData = accountData.map(acc => ({
    id: acc.id,
    handle: acc.handle,
    rsaPrivateKeyJwk: { key: faker.string.alphanumeric(20) },
    rsaPublicKeyJwk: { key: faker.string.alphanumeric(20) },
    ed25519PrivateKeyJwk: { key: faker.string.alphanumeric(20) },
    ed25519PublicKeyJwk: { key: faker.string.alphanumeric(20) },
    fields: { bio: faker.lorem.paragraph() },
    bio: faker.lorem.paragraph(),
    followedTags: [faker.lorem.word(), faker.lorem.word()],
    visibility: 'public',
    language: 'en',
  }));

  await batchInsert(accountOwners, accountOwnerData);
  console.log('Account owners seeded.');
}

// Seed posts
async function seedPosts() {
  postData = Array.from({ length: 100 }).map(() => ({
    id: uuidv4(),
    iri: faker.internet.url(),
    type: faker.helpers.arrayElement(['Note', 'Article', 'Question']),
    accountId: faker.helpers.arrayElement(accountData.map(acc => acc.id)),
    visibility: faker.helpers.arrayElement(['public', 'private', 'direct']),
    summary: faker.lorem.sentence(),
    contentHtml: faker.lorem.paragraphs(),
    content: faker.lorem.paragraph(),
    language: faker.helpers.arrayElement(['en', 'es', 'fr']),
    published: faker.date.past(),
    updated: faker.date.recent(),
  }));

  await batchInsert(posts, postData);
  console.log('Posts seeded.');
}

let followData;

// Seed follows
// Update the seedFollows function to ensure unique follower-following pairs
async function seedFollows() {
  const followSet = new Set();

  // Create a list of follows with unique relationships between accounts
  followData = Array.from({ length: 200 }).map(() => {
    let follower, following, key;

    // Ensure the following account is not the same as the follower and that the relationship is unique
    do {
      follower = faker.helpers.arrayElement(accountData);
      following = faker.helpers.arrayElement(accountData);
      key = `${follower.id}-${following.id}`;
    } while (follower.id === following.id || followSet.has(key));

    // Add the unique pair to the set
    followSet.add(key);

    return {
      iri: faker.internet.url(),
      followingId: following.id,
      followerId: follower.id,
      shares: faker.datatype.boolean(),
      notify: faker.datatype.boolean(),
      languages: faker.helpers.arrayElements(
        ['en', 'es', 'fr'],
        faker.helpers.rangeToNumber({ min: 1, max: 3 })
      ),
      created: faker.date.past(),
      approved: faker.date.recent(),
    };
  });

  await batchInsert(follows, followData);
  console.log('Follows seeded.');
}

// Add global variables to store like, reaction, and bookmark data
let likeData = [];
let reactionData = [];
let bookmarkData = [];

// Seed likes
async function seedLikes() {
  const likeSet = new Set();

  // Create random likes by accounts for posts
  likeData = Array.from({ length: 200 }).map(() => {
    let account, post, key;

    // Ensure unique account-post pairs
    do {
      account = faker.helpers.arrayElement(accountData);
      post = faker.helpers.arrayElement(postData);
      key = `${account.id}-${post.id}`;
    } while (likeSet.has(key));

    // Add the unique pair to the set
    likeSet.add(key);

    return {
      postId: post.id,
      accountId: account.id,
      created: faker.date.recent(),
    };
  });

  await batchInsert(likes, likeData);
  console.log('Likes seeded.');
}

// Seed reactions
async function seedReactions() {
  const reactionSet = new Set();
  const emojis = ['😀', '❤️', '👍', '😂', '😮', '😢'];

  // Create random reactions by accounts for posts
  reactionData = Array.from({ length: 200 }).map(() => {
    let account, post, emoji, key;

    // Ensure unique account-post-emoji triples
    do {
      account = faker.helpers.arrayElement(accountData);
      post = faker.helpers.arrayElement(postData);
      emoji = faker.helpers.arrayElement(emojis);
      key = `${account.id}-${post.id}-${emoji}`;
    } while (reactionSet.has(key));

    // Add the unique triple to the set
    reactionSet.add(key);

    return {
      postId: post.id,
      accountId: account.id,
      emoji: emoji,
      customEmoji: faker.helpers.maybe(() => faker.internet.emoji(), {
        probability: 0.3,
      }),
      created: faker.date.recent(),
    };
  });

  await batchInsert(reactions, reactionData);
  console.log('Reactions seeded.');
}

// Seed bookmarks
async function seedBookmarks() {
  const bookmarkSet = new Set();

  // Create random bookmarks by account owners for posts
  bookmarkData = Array.from({ length: 100 }).map(() => {
    let accountOwner, post, key;

    // Ensure unique accountOwner-post pairs
    do {
      accountOwner = faker.helpers.arrayElement(accountOwnerData);
      post = faker.helpers.arrayElement(postData);
      key = `${accountOwner.id}-${post.id}`;
    } while (bookmarkSet.has(key));

    // Add the unique pair to the set
    bookmarkSet.add(key);

    return {
      postId: post.id,
      accountOwnerId: accountOwner.id,
      created: faker.date.recent(),
    };
  });

  await batchInsert(bookmarks, bookmarkData);
  console.log('Bookmarks seeded.');
}

let muteData = [];
let blockData = [];

// Seed mutes
async function seedMutes() {
  const muteSet = new Set();

  muteData = Array.from({ length: 100 }).map(() => {
    let account, mutedAccount, key;

    // Ensure unique account-mutedAccount pairs
    do {
      account = faker.helpers.arrayElement(accountData);
      mutedAccount = faker.helpers.arrayElement(accountData);
      key = `${account.id}-${mutedAccount.id}`;
    } while (account.id === mutedAccount.id || muteSet.has(key));

    // Add the unique pair to the set
    muteSet.add(key);

    return {
      id: uuidv4(),
      accountId: account.id,
      mutedAccountId: mutedAccount.id,
      notifications: faker.datatype.boolean(),
      duration: faker.helpers.maybe(() => `${faker.number.int(1)} hours`, {
        probability: 0.5,
      }),
      created: faker.date.recent(),
    };
  });

  await batchInsert(mutes, muteData);
  console.log('Mutes seeded.');
}

// Seed blocks
async function seedBlocks() {
  const blockSet = new Set();

  blockData = Array.from({ length: 100 }).map(() => {
    let account, blockedAccount, key;

    // Ensure unique account-blockedAccount pairs
    do {
      account = faker.helpers.arrayElement(accountData);
      blockedAccount = faker.helpers.arrayElement(accountData);
      key = `${account.id}-${blockedAccount.id}`;
    } while (account.id === blockedAccount.id || blockSet.has(key));

    // Add the unique pair to the set
    blockSet.add(key);

    return {
      accountId: account.id,
      blockedAccountId: blockedAccount.id,
      created: faker.date.recent(),
    };
  });

  await batchInsert(blocks, blockData);
  console.log('Blocks seeded.');
}

// Update the main seeding function
async function runSeed() {
  try {
    console.log('Starting seeding process...');
    await seedAccounts();
    await seedAccountOwners();
    await seedPosts();
    await seedFollows();
    await seedLikes();
    await seedReactions();
    await seedBookmarks();
    await seedMutes();
    await seedBlocks();

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Error during seeding:', error);
  }
}

runSeed();

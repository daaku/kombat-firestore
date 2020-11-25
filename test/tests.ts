import {
  FirebaseAPI,
  FirebaseConfig,
  makeFirebaseAPI,
} from '@daaku/firebase-rest-api';
import { Merkle, Message, Timestamp } from '@daaku/kombat';
import { customAlphabet } from 'nanoid';

import { RemoteFirestore } from '../src';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz', 16);
const nodeID = nanoid();
const yodaID = nanoid();

const firebaseConfig = new FirebaseConfig({
  apiKey: 'AIzaSyCnFgFqO3d7RbJDcNAp_eO21KSOISCP9IU',
  projectID: 'fidb-unit-test',
});

const yodaNameMessage: Message = {
  timestamp: new Timestamp(1599729700000, 0, nodeID).toJSON(),
  dataset: 'people',
  row: yodaID,
  column: 'name',
  value: 'Yoda',
} as const;

const yodaAge900Message: Message = {
  timestamp: new Timestamp(1599729800000, 0, nodeID).toJSON(),
  dataset: 'people',
  row: yodaID,
  column: 'age',
  value: 900,
} as const;

const yodaAge950Message: Message = {
  timestamp: new Timestamp(1599729900000, 0, nodeID).toJSON(),
  dataset: 'people',
  row: yodaID,
  column: 'age',
  value: 950,
} as const;

interface NewUser {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
}

async function signUp(config: FirebaseConfig): Promise<NewUser> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.apiKey}`,
    { method: 'post' },
  );
  return await res.json();
}

async function deleteUser(
  config: FirebaseConfig,
  idToken: string,
): Promise<void> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${config.apiKey}`,
    {
      method: 'post',
      body: JSON.stringify({ idToken }),
    },
  );
  return await res.json();
}

async function deleteUserData(
  config: FirebaseConfig,
  api: FirebaseAPI,
  localID: string,
): Promise<void> {
  const res = (await api('post', ':runQuery', {
    structuredQuery: {
      from: [
        {
          collectionId: 'message_log',
        },
      ],
      where: {
        fieldFilter: {
          op: 'EQUAL',
          field: { fieldPath: 'groupID' },
          value: {
            stringValue: localID,
          },
        },
      },
    },
  })) as any[];
  const writes = [
    { delete: config.docPath(`merkle/${localID}`) },
    ...res.map((d) => {
      return { delete: d.document.name };
    }),
  ];
  await api('post', ':commit', { writes });
}

QUnit.test('Sync It', async (assert) => {
  const user = await signUp(firebaseConfig);
  const firebaseAPI = makeFirebaseAPI({
    config: firebaseConfig,
    tokenSource: async () => {
      return user.idToken;
    },
  });

  const merkle1 = new Merkle();
  const remote1 = new RemoteFirestore({
    config: firebaseConfig,
    api: firebaseAPI,
    groupID: user.localId,
  });

  const messages1 = [yodaNameMessage, yodaAge900Message];
  messages1.forEach((msg) => {
    merkle1.insert(Timestamp.fromJSON(msg.timestamp));
  });

  await remote1.sync({
    merkle: merkle1,
    messages: messages1,
  });

  await remote1.sync({
    merkle: merkle1,
    messages: messages1,
  });

  const merkle2 = new Merkle();
  const remote2 = new RemoteFirestore({
    config: firebaseConfig,
    api: firebaseAPI,
    groupID: user.localId,
  });
  const result = await remote2.sync({
    merkle: merkle2,
    messages: [],
  });
  assert.deepEqual(result.messages, messages1);

  const messages2 = [yodaAge950Message];
  messages2.forEach((msg) => {
    merkle1.insert(Timestamp.fromJSON(msg.timestamp));
  });

  await remote1.sync({
    merkle: merkle1,
    messages: messages2,
  });

  await deleteUserData(firebaseConfig, firebaseAPI, user.localId);
  await deleteUser(firebaseConfig, user.idToken);
});

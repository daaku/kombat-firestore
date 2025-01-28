import QUnit from 'qunit'
import 'qunit/qunit/qunit.css'
import {
  FirebaseAPI,
  FirebaseConfig,
  makeFirebaseAPI,
} from '@daaku/firebase-rest-api'
import { Merkle, Message, Timestamp } from '@daaku/kombat'
import { customAlphabet } from 'nanoid'

import { RemoteFirestore } from '../src/index.js'

// @ts-ignore
window.HARNESS_RUN_END && QUnit.on('runEnd', window.HARNESS_RUN_END)

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz', 16)
const nodeID = nanoid()
const yodaID = nanoid()

const firebaseConfig = new FirebaseConfig({
  apiKey: 'AIzaSyCnFgFqO3d7RbJDcNAp_eO21KSOISCP9IU',
  projectID: 'fidb-unit-test',
})

// NOTE: we're relying on knowing that kombat rounds to the minute.
// if this assumption is broken, we may get back more messages than expected.
// this is not techincally a problem, this will happen in production.
// but it breaks the tests assumption.

const nextTimestamp = (() => {
  // start rounded on the minute
  let ts = new Date('2015-05-15').getTime()
  return (): number => {
    ts = ts + 61 * 1000
    return ts
  }
})()

const yodaNameMessage: Message = {
  timestamp: new Timestamp(nextTimestamp(), 0, nodeID).toJSON(),
  dataset: 'people',
  row: yodaID,
  column: 'name',
  value: 'Yoda',
} as const

const yodaAge900Message: Message = {
  timestamp: new Timestamp(nextTimestamp(), 0, nodeID).toJSON(),
  dataset: 'people',
  row: yodaID,
  column: 'age',
  value: 900,
} as const

const yodaAge950Message: Message = {
  timestamp: new Timestamp(nextTimestamp(), 0, nodeID).toJSON(),
  dataset: 'people',
  row: yodaID,
  column: 'age',
  value: 950,
} as const

const yodaDeleteNameMessage: Message = {
  timestamp: new Timestamp(nextTimestamp(), 0, nodeID).toJSON(),
  dataset: 'people',
  row: yodaID,
  column: 'age',
  value: undefined,
} as const

interface NewUser {
  idToken: string
  refreshToken: string
  expiresIn: string
  localId: string
}

async function signUp(config: FirebaseConfig): Promise<NewUser> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.apiKey}`,
    { method: 'post' },
  )
  return await res.json()
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
  )
  return await res.json()
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
  })) as any[]
  const writes = [
    { delete: config.docPath(`merkle/${localID}`) },
    ...res.map(d => {
      return { delete: d.document.name }
    }),
  ]
  await api('post', ':commit', { writes })
}

QUnit.test('Sync It', async assert => {
  assert.timeout(30000)
  const user = await signUp(firebaseConfig)
  const firebaseAPI = makeFirebaseAPI({
    config: firebaseConfig,
    tokenSource: async () => {
      return user.idToken
    },
  })

  const merkle1 = new Merkle()
  const remote1 = new RemoteFirestore({
    config: firebaseConfig,
    api: firebaseAPI,
    groupID: user.localId,
  })

  const messages1 = [yodaNameMessage, yodaAge900Message]
  messages1.forEach(msg => {
    merkle1.insert(Timestamp.fromJSON(msg.timestamp))
  })

  // send the merkle & messages
  const resultInitial = await remote1.sync({
    merkle: merkle1,
    messages: messages1,
  })
  assert.deepEqual(
    merkle1.diff(resultInitial.merkle),
    undefined,
    'resultInitial merkle should be same as merkle1',
  )
  assert.deepEqual(
    resultInitial.messages.length,
    0,
    'empty remote should have nothing pending',
  )

  // send again to ensure idempotency
  const resultIdempotent = await remote1.sync({
    merkle: merkle1,
    messages: messages1,
  })
  assert.deepEqual(
    merkle1.diff(resultIdempotent.merkle),
    undefined,
    'merkle should be idempotent',
  )
  assert.deepEqual(
    resultIdempotent.messages.length,
    0,
    'remote should have nothing pending and be idempotent',
  )

  let merkle2 = new Merkle()
  const remote2 = new RemoteFirestore({
    config: firebaseConfig,
    api: firebaseAPI,
    groupID: user.localId,
  })

  // we should get back the messages since they are unknown to us
  const resultFreshSignIn = await remote2.sync({
    merkle: merkle2,
    messages: [],
  })
  assert.deepEqual(
    merkle1.diff(resultFreshSignIn.merkle),
    undefined,
    'resultFreshSignIn should get merkle1 in the result',
  )
  assert.deepEqual(
    resultFreshSignIn.messages,
    messages1,
    'resultFreshSignIn should get messages1',
  )

  // update merkle2 to the new merkle
  merkle2 = resultFreshSignIn.merkle

  const messages2 = [yodaAge950Message, yodaDeleteNameMessage]
  messages2.forEach(msg => {
    merkle2.insert(Timestamp.fromJSON(msg.timestamp))
  })

  // send the second set of messages via remote2
  const resultMoreMessages = await remote2.sync({
    merkle: merkle2,
    messages: messages2,
  })
  assert.deepEqual(
    merkle2.diff(resultMoreMessages.merkle),
    undefined,
    'resultMoreMessages is already caught up and has the right merkle',
  )
  assert.deepEqual(
    resultMoreMessages.messages.length,
    0,
    'resultMoreMessages is already caught up and should have no messages pending',
  )

  // remote1 should now get those messages back
  const resultCatchUp = await remote1.sync({
    merkle: merkle1,
    messages: [],
  })
  assert.deepEqual(
    merkle2.diff(resultCatchUp.merkle),
    undefined,
    'resultCatchUp should return merkle2',
  )
  assert.deepEqual(
    resultCatchUp.messages,
    messages2,
    'resultCatchUp should return messages2',
  )

  await deleteUserData(firebaseConfig, firebaseAPI, user.localId)
  await deleteUser(firebaseConfig, user.idToken)
})

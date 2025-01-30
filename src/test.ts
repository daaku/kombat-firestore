import { FirebaseAPI, FirebaseConfig } from '@daaku/firebase-rest-api'

export interface NewUser {
  idToken: string
  refreshToken: string
  expiresIn: string
  localId: string
}

export async function signUpAnon(config: FirebaseConfig): Promise<NewUser> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.apiKey}`,
    { method: 'post' },
  )
  return await res.json()
}

export async function deleteUser(
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

const whereGroupID = (groupID: string) => ({
  compositeFilter: {
    op: 'OR',
    filters: [
      {
        fieldFilter: {
          op: 'EQUAL',
          field: { fieldPath: 'groupID' },
          value: {
            stringValue: groupID,
          },
        },
      },
      {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                op: 'GREATER_THAN_OR_EQUAL',
                field: { fieldPath: 'groupID' },
                value: {
                  stringValue: `${groupID}.`,
                },
              },
            },
            {
              fieldFilter: {
                op: 'LESS_THAN',
                field: { fieldPath: 'groupID' },
                value: {
                  // the slash is char code 47, one more than the '.'
                  stringValue: `${groupID}/`,
                },
              },
            },
          ],
        },
      },
    ],
  },
})

export async function deleteUserData(
  api: FirebaseAPI,
  localID: string,
): Promise<void> {
  const merkles = (await api('post', ':runQuery', {
    structuredQuery: {
      from: [
        {
          collectionId: 'merkle',
        },
      ],
      where: whereGroupID(localID),
    },
  })) as any[]
  const messages = (await api('post', ':runQuery', {
    structuredQuery: {
      from: [
        {
          collectionId: 'message_log',
        },
      ],
      where: whereGroupID(localID),
    },
  })) as any[]
  const writes = merkles
    .concat(messages)
    .filter(d => d.document)
    .map(d => {
      return { delete: d.document.name }
    })
  await api('post', ':commit', { writes })
}

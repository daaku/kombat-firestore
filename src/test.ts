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

export async function deleteUserData(
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

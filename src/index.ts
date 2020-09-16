import { SyncRequest, Remote, Message, Timestamp, Merkle } from '@daaku/kombat';
import type { FirebaseConfig, FirebaseAPI } from '@daaku/firebase-rest-api';

function docToMsg(doc: any): Message {
  return {
    timestamp: doc.document.fields.timestamp.stringValue,
    dataset: doc.document.fields.dataset.stringValue,
    row: doc.document.fields.row.stringValue,
    column: doc.document.fields.column.stringValue,
    value: JSON.parse(doc.document.fields.value.stringValue),
  };
}

export class RemoteFirestore implements Remote {
  private readonly merkleDocPath: string;
  private readonly config: FirebaseConfig;
  private readonly api: FirebaseAPI;
  private readonly groupID: string;

  constructor({
    config,
    api,
    groupID,
  }: {
    config: FirebaseConfig;
    api: FirebaseAPI;
    groupID: string;
  }) {
    this.config = config;
    this.api = api;
    this.groupID = groupID;
    this.merkleDocPath = this.config.docPath(`merkle/${this.groupID}`);
  }

  private msgDocPath(timestamp: string): string {
    return this.config.docPath(`message_log/${timestamp}`);
  }

  private msgUpdateDoc(msg: Message): any {
    return {
      update: {
        name: this.msgDocPath(msg.timestamp),
        fields: {
          groupID: { stringValue: this.groupID },
          timestamp: { stringValue: msg.timestamp },
          dataset: { stringValue: msg.dataset },
          row: { stringValue: msg.row },
          column: { stringValue: msg.column },
          value: { stringValue: JSON.stringify(msg.value) },
        },
      },
    };
  }

  public async sync(req: SyncRequest): Promise<SyncRequest> {
    // get the existing merkle and check if any of messages are already stored
    const batchGet = (await this.api('post', ':batchGet', {
      documents: [
        this.merkleDocPath,
        ...req.messages.map((msg) => this.msgDocPath(msg.timestamp)),
      ],
      mask: { fieldPaths: ['merkle'] },
    })) as any[];

    // there are 3 merkle's involved, the merkle from the request, the existing
    // merkle on the firestore side, and the new merkle we need to store on the
    // firestore side.

    // calculate the new merkle for the firestore side.
    const [merkleRaw, ...messages] = batchGet;
    let existingMerkle = new Merkle();
    let newMerkle = new Merkle();
    let pendingSend: Message[] = [];
    if (merkleRaw.missing) {
      // all messages should be missing, otherwise we're in a corrupt state.
      if (messages.some((m) => m.found)) {
        throw new Error('corruption: no merkle found, but messages were found');
      }
      pendingSend = req.messages;
    } else {
      existingMerkle = Merkle.fromJSON(
        JSON.parse(merkleRaw.found.fields.merkle.stringValue),
      );
      newMerkle = existingMerkle.clone();
      messages.forEach((m, index) => {
        if (m.missing) {
          pendingSend.push(req.messages[index]);
        }
      });
    }

    // update the merkle with the messages we'll be inserting, if any
    pendingSend.forEach((m) => {
      newMerkle.insert(Timestamp.fromJSON(m.timestamp));
    });

    // now collect the writes, if any. this will be updates to the merkle and
    // new messages to write.
    const writes = [];

    // write an updated merkle if we changed it
    if (existingMerkle.diff(newMerkle)) {
      const write = {
        update: {
          name: this.merkleDocPath,
          fields: {
            merkle: { stringValue: JSON.stringify(newMerkle) },
          },
        },
      } as any;

      // either update the exact document we just read, or ensure we're writing
      // a new one. this prevents race conditions.
      if (merkleRaw.found) {
        write.currentDocument = {
          updateTime: merkleRaw.updateTime,
        };
      } else {
        write.currentDocument = {
          exists: false,
        };
      }

      writes.push(write);
    }

    // write all pending messages, if any
    writes.push(...pendingSend.map(this.msgUpdateDoc.bind(this)));

    // if we have something to write, then write it.
    if (writes.length > 0) {
      await this.api('post', ':commit', { writes });
      // TODO: check if the writes went thru, if not retry
    }

    let pendingIncoming: Message[] = [];

    // if there are differences in the merkle after updating firestore, then
    // fetch pending incoming messages.
    const diffTime = newMerkle.diff(req.merkle);
    if (diffTime) {
      const result = (await this.api('post', ':runQuery', {
        structuredQuery: {
          from: [
            {
              collectionId: 'message_log',
            },
          ],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                {
                  fieldFilter: {
                    op: 'EQUAL',
                    field: { fieldPath: 'groupID' },
                    value: {
                      stringValue: this.groupID,
                    },
                  },
                },
                {
                  fieldFilter: {
                    op: 'GREATER_THAN_OR_EQUAL',
                    field: { fieldPath: 'timestamp' },
                    value: {
                      stringValue: String(diffTime),
                    },
                  },
                },
              ],
            },
          },
          orderBy: [
            {
              field: { fieldPath: 'timestamp' },
              direction: 'ASCENDING',
            },
          ],
        },
      })) as any[];
      pendingIncoming = result.map(docToMsg);
    }

    // return pending sync messages
    return {
      merkle: newMerkle,
      messages: pendingIncoming,
    };
  }
}

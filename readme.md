kombat-firestore
================

Kombat storage implemented using Firebase Firestore Database.

Sample rules for when Group ID is set to User ID:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // merkle is stored with same ID as user ID
    match /merkle/{document} {
      allow read: if resource == null
      allow read, write: if request.auth.uid == document;
    }

    // messages are stored with group ID as user ID
    match /message_log/{document} {
      allow read: if resource == null
      allow create: if request.auth.uid == request.resource.data.groupID;
      allow read, write: if request.auth.uid == resource.data.groupID;
    }
  }
}
```


## TODO
- [ ] Retries
- [ ] Pagination in runQuery
- [ ] Splitting commit if too large

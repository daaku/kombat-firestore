kombat-firestore
================

Kombat storage implemented using Firebase Firestore Database.

Sample rules for when Group ID is set to User ID:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // allow exact or `uid.` prefix
    function allowGroupID(id) {
      let exact = request.auth.uid == id;
      let prefix = request.auth.uid == id.split('\\.')[0];
      return exact || prefix
    }

    // merkle is stored with same ID as user ID
    match /merkle/{document} {
      allow read: if resource == null
      allow read, write: if allowGroupID(document)
    }

    // messages are stored with group ID as user ID
    match /message_log/{document} {
      allow read: if resource == null
      allow create: if allowGroupID(request.resource.data.groupID)
      allow write: if resource == null && allowGroupID(request.resource.data.groupID)
      allow read, write: if allowGroupID(resource.data.groupID)
    }
  }
}
```

## TODO
- [ ] Retries
- [ ] Pagination in runQuery
- [ ] Splitting commit if too large

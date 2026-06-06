# My Chat App + Database 💬🗄️

Node.js + Express + Socket.IO + **MongoDB** se bana real-time chat app.
Ab messages permanently save hote hain — server band ho jaye to bhi nahi khote.

---

## Poore Steps (shuru se aakhir tak)

### STEP 1: Node.js install karein
https://nodejs.org se LTS version. Check:
```
node -v
```

### STEP 2: MongoDB hasil karein (do mein se ek)

**Option A — Cloud (Atlas), RECOMMENDED, kuch install nahi:**
1. https://www.mongodb.com/cloud/atlas/register par free account banayein
2. Free cluster (M0) banayein
3. "Connect" > "Connect your application" > connection string copy karein
   (kuch is tarah: `mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/chatapp`)
4. Database Access mein ek user/password banayein
5. Network Access mein "Allow from anywhere" (0.0.0.0/0) add karein

**Option B — Local install (apne computer par):**
1. https://www.mongodb.com/try/download/community se download + install
2. Connection string hogi: `mongodb://127.0.0.1:27017/chatapp`

### STEP 3: server.js mein connection string lagayein
`server.js` kholein, ye line dhoondein:
```js
const MONGO_URL = "mongodb://127.0.0.1:27017/chatapp";
```
Apni string yahan paste karein (Atlas wali ya local wali).

### STEP 4: Libraries install karein
Is folder mein terminal khol kar:
```
npm install
```

### STEP 5: Server chalayein
```
npm start
```
Dikhega:
```
MongoDB connect ho gaya
Server chal raha hai: http://localhost:3000
```
Agar "MongoDB connect nahi hua" aaye to connection string ya internet/network access check karein.

### STEP 6: Browser mein test karein
http://localhost:3000 kholein. 2 tabs mein alag naam dein aur baat karein.

### STEP 7: Database check karein (yahi to seekhna tha!)
- Atlas par: cluster > "Browse Collections" > `chatapp` > `messages` — yahan aapke saare messages save dikhenge!
- Ab server band kar ke dobara chalayein aur app refresh karein — purani chat wapas aa jayegi. ✅

---

## Naya kya hua (v1 ke muqable)
- `mongoose` library add hui (MongoDB se baat karne ke liye)
- Har message ab database mein `save()` hota hai
- App khulte hi purane 50 messages load ho jate hain (`load messages`)
- Har message ke saath time bhi save aur display hota hai

## Aage ke liye ideas
- Login system (username + password, `bcrypt` se password hash karein)
- Private 1-to-1 chat (rooms)
- Online/offline status
- Photo/file bhejna
- Messages delete/edit karna

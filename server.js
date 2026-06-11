// ====================================================
//  server.js  —  PRIVATE chat with INVITE-LINK contacts
//  Node.js + Express + Socket.IO + MongoDB
//
//  Ab har koi sab ko nahi dekhta. Sirf un logon se baat
//  ho sakti hai jinke saath aap invite-link ke zariye
//  "juday" hain (mutual contact).
// ====================================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// ---- Database se connect ----
const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/chatapp";
mongoose
  .connect(MONGO_URL)
  .then(() => console.log("MongoDB connect ho gaya"))
  .catch((err) => console.log("MongoDB connect nahi hua:", err.message));

// ---- User: ab inviteCode aur contacts bhi rakhte hain ----
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  inviteCode: { type: String, unique: true, sparse: true }, // personal invite link ka code
  contacts: { type: [String], default: [] },                 // sirf inse baat ho sakti hai
});
const User = mongoose.model("User", userSchema);

// ---- Message ka structure ----
const messageSchema = new mongoose.Schema({
  from: String,
  to: String,
  text: String,
  time: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", messageSchema);

// Online users: username -> socket.id
const onlineUsers = {};

// Chhota random invite code banao
function makeCode() {
  return crypto.randomBytes(5).toString("hex"); // 10 characters
}

// Kisi ek user ki contact list (sirf uske apne contacts) us tak bhejo
async function pushContacts(username) {
  const sid = onlineUsers[username];
  if (!sid) return; // offline hai to kuch nahi
  const user = await User.findOne({ username });
  if (!user) return;
  const list = (user.contacts || [])
    .map((c) => ({ username: c, online: Boolean(onlineUsers[c]) }))
    .sort((a, b) => a.username.localeCompare(b.username));
  io.to(sid).emit("user list", list);
}

// User + uske sab contacts ki list refresh karo (online/offline status ke liye)
async function refreshAround(username) {
  const user = await User.findOne({ username });
  await pushContacts(username);
  if (user) {
    for (const c of user.contacts || []) await pushContacts(c);
  }
}

io.on("connection", (socket) => {
  console.log("Naya connection:", socket.id);

  // --- 1) Register: user apna naam batata hai ---
  socket.on("register", async (username) => {
    socket.username = username;          // (synchronously set — zaroori hai)
    onlineUsers[username] = socket.id;

    let user = await User.findOne({ username });
    if (!user) {
      user = await User.create({ username, inviteCode: makeCode(), contacts: [] });
    } else if (!user.inviteCode) {
      user.inviteCode = makeCode();      // purane user ko bhi code de do
      await user.save();
    }

    // Apna invite code wapas bhejo (frontend ise share-link banayega)
    socket.emit("your invite", { inviteCode: user.inviteCode });

    await refreshAround(username);
  });

  // --- 2) Invite link se judna ---
  socket.on("use invite", async (code) => {
    const me = socket.username;
    if (!me || !code) return;

    const owner = await User.findOne({ inviteCode: code });
    if (!owner || owner.username === me) return; // ghalat code ya apna hi link

    // Dono taraf mutual contact add karo (duplicate na ho)
    await User.updateOne({ username: owner.username }, { $addToSet: { contacts: me } });
    await User.updateOne({ username: me }, { $addToSet: { contacts: owner.username } });

    await pushContacts(me);
    await pushContacts(owner.username);

    socket.emit("invite done", { withUser: owner.username });
  });

  // --- 3) Do logon ke darmiyan purani baat-cheet load karo ---
  socket.on("load conversation", async (otherUser) => {
    const me = socket.username;
    const msgs = await Message.find({
      $or: [
        { from: me, to: otherUser },
        { from: otherUser, to: me },
      ],
    }).sort({ time: 1 });
    socket.emit("conversation", { withUser: otherUser, messages: msgs });
  });

  // --- 4) Private message bhejna (sirf contact ko) ---
  socket.on("private message", async (data) => {
    const from = socket.username;
    if (!from) return;

    // Privacy: sirf apne contact ko message bhej sakte ho
    const sender = await User.findOne({ username: from });
    if (!sender || !(sender.contacts || []).includes(data.to)) return;

    const saved = await new Message({
      from,
      to: data.to,
      text: data.text,
    }).save();

    const payload = { from, to: data.to, text: saved.text, time: saved.time };

    const toSocketId = onlineUsers[data.to];
    if (toSocketId) io.to(toSocketId).emit("private message", payload);
    socket.emit("private message", payload); // khud ko bhi, taake foran dikhe
  });

  // --- 5) Typing indicator (sirf us bande ko jise message ja raha hai) ---
  socket.on("typing", (data) => {
    const from = socket.username;
    if (!from) return;
    const toSocketId = onlineUsers[data.to];
    if (toSocketId) io.to(toSocketId).emit("typing", { from });
  });

  // --- 6) Disconnect: online list se hatao + contacts ko batao ---
  socket.on("disconnect", async () => {
    if (socket.username) {
      const name = socket.username;
      delete onlineUsers[name];
      await refreshAround(name);
    }
  });
});

// Render khud PORT deta hai; local par 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server chal raha hai: http://localhost:${PORT}`);
});

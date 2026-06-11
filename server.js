// ====================================================
//  server.js  —  PRIVATE chat with LOGIN + INVITE links
//  Node.js + Express + Socket.IO + MongoDB
//
//  - Har user ka username + password hota hai (password
//    hashed save hota hai, plain text nahi).
//  - Login ke baad ek token milta hai, taake refresh par
//    dobara password na likhna paray.
//  - Sirf invite-link se juday hue contacts se baat ho sakti hai.
// ====================================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
// maxHttpBufferSize barhaya taake image/file (base64) bhej sakein (~6MB)
const io = new Server(server, { maxHttpBufferSize: 6e6 });

app.use(express.static(path.join(__dirname, "public")));

// ---- Database ----
const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/chatapp";
mongoose
  .connect(MONGO_URL)
  .then(() => console.log("MongoDB connect ho gaya"))
  .catch((err) => console.log("MongoDB connect nahi hua:", err.message));

// ---- User ----
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: String,                                       // hashed password
  tokens: { type: [String], default: [] },                   // login sessions
  inviteCode: { type: String, unique: true, sparse: true },  // personal invite link
  contacts: { type: [String], default: [] },                 // sirf inse baat ho sakti hai
});
const User = mongoose.model("User", userSchema);

// ---- Message ----
const messageSchema = new mongoose.Schema({
  from: String,
  to: String,
  type: { type: String, default: "text" }, // "text" | "image" | "file"
  text: String,
  media: String,                            // base64 data URL (image/file)
  fileName: String,                         // file ka asli naam
  time: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", messageSchema);

const onlineUsers = {}; // username -> socket.id

// ---- Helpers ----
function makeCode() { return crypto.randomBytes(5).toString("hex"); }   // invite code
function makeToken() { return crypto.randomBytes(24).toString("hex"); } // login token

// Password ko salt ke saath hash karo: "salt:hash"
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}
// Password sahi hai ya nahi (timing-safe)
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Kisi user ki contact list (sirf uske contacts) us tak bhejo
async function pushContacts(username) {
  const sid = onlineUsers[username];
  if (!sid) return;
  const user = await User.findOne({ username });
  if (!user) return;
  const list = (user.contacts || [])
    .map((c) => ({ username: c, online: Boolean(onlineUsers[c]) }))
    .sort((a, b) => a.username.localeCompare(b.username));
  io.to(sid).emit("user list", list);
}

// User + uske contacts ki list refresh karo (online status)
async function refreshAround(username) {
  const user = await User.findOne({ username });
  await pushContacts(username);
  if (user) for (const c of user.contacts || []) await pushContacts(c);
}

// Login kamyab hone ke baad ka common kaam
async function finishLogin(socket, user, token) {
  socket.username = user.username;          // (sync — pehle set karo)
  onlineUsers[user.username] = socket.id;
  socket.emit("auth ok", { username: user.username, token });
  socket.emit("your invite", { inviteCode: user.inviteCode });
  await refreshAround(user.username);
}

io.on("connection", (socket) => {
  console.log("Naya connection:", socket.id);

  // ---- SIGN UP (naya account) ----
  socket.on("signup", async ({ username, password }) => {
    try {
      username = (username || "").trim();
      if (!username || !password)
        return socket.emit("auth error", "Naam aur password dono zaroori hain.");
      if (password.length < 4)
        return socket.emit("auth error", "Password kam se kam 4 characters ka ho.");

      // SAKHT: agar ye naam kisi bhi soorat mein mojood hai (chahe password ho ya na ho)
      // to signup allow NAHI — koi doosre ka account claim nahi kar sakta.
      const existing = await User.findOne({ username });
      if (existing)
        return socket.emit("auth error", "Ye naam pehle se mojood hai. Doosra naam chunein ya Login karein.");

      const token = makeToken();
      const user = await User.create({
        username,
        passwordHash: hashPassword(password),
        inviteCode: makeCode(),
        contacts: [],
        tokens: [token],
      });
      await finishLogin(socket, user, token);
    } catch (e) {
      console.log("signup error:", e.message);
      socket.emit("auth error", "Kuch masla hua, dobara koshish karein.");
    }
  });

  // ---- LOGIN (mojooda account) ----
  socket.on("login", async ({ username, password }) => {
    try {
      username = (username || "").trim();
      const user = await User.findOne({ username });
      if (!user || !user.passwordHash)
        return socket.emit("auth error", "Ye naam mojood nahi. Pehle Sign up karein.");
      if (!verifyPassword(password, user.passwordHash))
        return socket.emit("auth error", "Password ghalat hai.");

      const token = makeToken();
      user.tokens = user.tokens || [];
      user.tokens.push(token);
      if (!user.inviteCode) user.inviteCode = makeCode();
      await user.save();
      await finishLogin(socket, user, token);
    } catch (e) {
      console.log("login error:", e.message);
      socket.emit("auth error", "Kuch masla hua, dobara koshish karein.");
    }
  });

  // ---- AUTO-LOGIN (saved token se) ----
  socket.on("auth token", async ({ username, token }) => {
    try {
      const user = await User.findOne({ username });
      if (!user || !token || !(user.tokens || []).includes(token))
        return socket.emit("auth required");
      await finishLogin(socket, user, token);
    } catch (e) {
      socket.emit("auth required");
    }
  });

  // ---- LOGOUT (token hatao) ----
  socket.on("logout", async (token) => {
    if (socket.username)
      await User.updateOne({ username: socket.username }, { $pull: { tokens: token } });
  });

  // ---- Invite link se judna (login ke baad) ----
  socket.on("use invite", async (code) => {
    const me = socket.username;
    if (!me || !code) return;
    const owner = await User.findOne({ inviteCode: code });
    if (!owner || owner.username === me) return;
    await User.updateOne({ username: owner.username }, { $addToSet: { contacts: me } });
    await User.updateOne({ username: me }, { $addToSet: { contacts: owner.username } });
    await pushContacts(me);
    await pushContacts(owner.username);
    socket.emit("invite done", { withUser: owner.username });
  });

  // ---- Purani baat-cheet ----
  socket.on("load conversation", async (otherUser) => {
    const me = socket.username;
    if (!me) return;
    const msgs = await Message.find({
      $or: [
        { from: me, to: otherUser },
        { from: otherUser, to: me },
      ],
    }).sort({ time: 1 });
    socket.emit("conversation", { withUser: otherUser, messages: msgs });
  });

  // ---- Private message (sirf apne contact ko) ----
  socket.on("private message", async (data) => {
    const from = socket.username;
    if (!from) return;
    const sender = await User.findOne({ username: from });
    if (!sender || !(sender.contacts || []).includes(data.to)) return;

    const type = data.type || "text";
    const media = data.media || "";
    // size guard: media ~6MB se chhoti honi chahiye
    if (media && media.length > 8_000_000) return;
    // khali message (na text, na media) reject
    if (type === "text" && !(data.text || "").trim()) return;
    if (type !== "text" && !media) return;

    const saved = await new Message({
      from,
      to: data.to,
      type,
      text: data.text || "",
      media,
      fileName: data.fileName || "",
    }).save();

    const payload = {
      from, to: data.to,
      type: saved.type, text: saved.text,
      media: saved.media, fileName: saved.fileName,
      time: saved.time,
    };
    const toSocketId = onlineUsers[data.to];
    if (toSocketId) io.to(toSocketId).emit("private message", payload);
    socket.emit("private message", payload);
  });

  // ---- Typing ----
  socket.on("typing", (data) => {
    const from = socket.username;
    if (!from) return;
    const toSocketId = onlineUsers[data.to];
    if (toSocketId) io.to(toSocketId).emit("typing", { from });
  });

  // ---- Disconnect ----
  socket.on("disconnect", async () => {
    if (socket.username) {
      const name = socket.username;
      delete onlineUsers[name];
      await refreshAround(name);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chal raha hai: http://localhost:${PORT}`));

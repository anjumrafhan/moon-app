// ====================================================
//  server.js  —  PRIVATE 1-to-1 chat (WhatsApp jaisa DM)
//  Node.js + Express + Socket.IO + MongoDB
// ====================================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
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

// ---- User ka structure (sirf naam, password nahi) ----
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
});
const User = mongoose.model("User", userSchema);

// ---- Message ka structure: ab "from" aur "to" hai ----
const messageSchema = new mongoose.Schema({
  from: String, // kis ne bheja
  to: String,   // kis ko bheja
  text: String,
  time: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", messageSchema);

// Online users ko yaad rakhne ke liye: username -> socket.id
const onlineUsers = {};

// Sab logon ko taaza contacts list bhejo (online flag ke saath)
async function sendUserList() {
  const all = await User.find().sort({ username: 1 });
  const list = all.map((u) => ({
    username: u.username,
    online: Boolean(onlineUsers[u.username]),
  }));
  io.emit("user list", list);
}

io.on("connection", (socket) => {
  console.log("Naya connection:", socket.id);

  // --- 1) Register: user apna naam batata hai ---
  socket.on("register", async (username) => {
    socket.username = username;
    onlineUsers[username] = socket.id;

    // User ko database mein add karo (agar pehle se nahi hai)
    await User.updateOne({ username }, { username }, { upsert: true });
    await sendUserList();
  });

  // --- 2) Do logon ke darmiyan purani baat-cheet load karo ---
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

  // --- 3) Private message bhejna (sirf us ek bande ko) ---
  socket.on("private message", async (data) => {
    // data = { to, text }
    const from = socket.username;
    const saved = await new Message({
      from,
      to: data.to,
      text: data.text,
    }).save();

    const payload = { from, to: data.to, text: saved.text, time: saved.time };

    // Recipient ko bhejo (agar online hai)
    const toSocketId = onlineUsers[data.to];
    if (toSocketId) io.to(toSocketId).emit("private message", payload);

    // Khud ko bhi bhejo, taake apni screen par foran dikhe
    socket.emit("private message", payload);
  });

  // --- 3.5) Typing indicator (sirf us bande ko jise message ja raha hai) ---
  socket.on("typing", (data) => {
    // data = { to }
    const from = socket.username;
    if (!from) return;
    const toSocketId = onlineUsers[data.to];
    if (toSocketId) io.to(toSocketId).emit("typing", { from });
  });

  // --- 4) Disconnect: online list se hatao ---
  socket.on("disconnect", async () => {
    if (socket.username) {
      delete onlineUsers[socket.username];
      await sendUserList();
    }
  });
});

// Render khud PORT deta hai; local par 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server chal raha hai: http://localhost:${PORT}`);
});

// ====================================================
//  server.js  —  Chat app ka backend + DATABASE
//  Node.js + Express + Socket.IO + MongoDB (mongoose)
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

// ====================================================
//  STEP A: DATABASE SE CONNECT
//  Niche apni connection string lagayein.
//  - Atlas (cloud) wali:  mongodb+srv://....../chatapp
//  - Local wali:          mongodb://127.0.0.1:27017/chatapp
// ====================================================
const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/chatapp";
mongoose
  .connect(MONGO_URL)
  .then(() => console.log("MongoDB connect ho gaya"))
  .catch((err) => console.log("MongoDB connect nahi hua:", err.message));

// ====================================================
//  STEP B: MESSAGE KA STRUCTURE (Schema + Model)
//  Schema = batata hai ek message kaisa dikhega.
//  Model  = isi ke zariye hum save/find karte hain.
// ====================================================
const messageSchema = new mongoose.Schema({
  user: String,
  text: String,
  time: { type: Date, default: Date.now }, // khud time laga dega
});

const Message = mongoose.model("Message", messageSchema);

// ====================================================
//  STEP C: SOCKET.IO — real-time logic
// ====================================================
io.on("connection", async (socket) => {
  console.log("Naya user connect hua:", socket.id);

  // --- Jab user aaye, purane 50 messages database se nikal kar bhejo ---
  try {
    const oldMessages = await Message.find().sort({ time: 1 }).limit(50);
    socket.emit("load messages", oldMessages);
  } catch (err) {
    console.log("Purane messages load nahi hue:", err.message);
  }

  // --- Jab naya message aaye ---
  socket.on("chat message", async (data) => {
    try {
      // 1) Message ko DATABASE mein save karo
      const saved = await new Message({
        user: data.user,
        text: data.text,
      }).save();

      // 2) Phir sabhi connected users ko bhej do
      io.emit("chat message", {
        user: saved.user,
        text: saved.text,
        time: saved.time,
      });
    } catch (err) {
      console.log("Message save nahi hua:", err.message);
    }
  });

  // --- "typing..." ---
  socket.on("typing", (username) => {
    socket.broadcast.emit("typing", username);
  });

  socket.on("disconnect", () => {
    console.log("User chala gaya:", socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server chal raha hai: http://localhost:${PORT}`);
});

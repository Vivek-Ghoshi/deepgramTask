const { writeFile, appendFile } = require("fs/promises");
const fs = require("fs");
const { createClient, AgentEvents } = require("@deepgram/sdk");
const fetch = require("cross-fetch");
const { join } = require("path");
const wav = require("node-wav");
const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: '0.0.0.0' });
let clients = [];

console.log("📡 WebSocket server started on port 5000");

wss.on("connection", (ws) => {
  console.log("✅ Frontend connected via WebSocket");
  clients.push(ws);

  ws.on("message", (message) => {
    if (!message) return;

    // 🟢 Text message from frontend
    if (typeof message === "string") {
      try {
        const data = JSON.parse(message);
        if (data.userText && globalThis.agentConnection) {
          console.log("📨 Received user text from frontend:", data.userText);
          console.log("↪️ Sending user text to Deepgram agent...");
          globalThis.agentConnection.sendUserText(data.userText);
        }
      } catch (e) {
        console.log("❌ Invalid JSON message from frontend:", message);
      }
    }

    // 🔊 Audio stream (raw PCM buffer)
    if (Buffer.isBuffer(message)) {
      console.log("🎙️ Received raw PCM audio buffer from frontend");
      if (globalThis.agentConnection) {
        console.log("📤 Forwarding raw PCM audio to Deepgram agent...");
        globalThis.agentConnection.send(message);
      }
    }
  });

  ws.on("close", () => {
    console.log("❌ Frontend WebSocket connection closed");
    clients = clients.filter((client) => client !== ws);
  });
});

// Deepgram API Setup
const apiKey = "d7bcbc2b02e3998caff7e28c32b876d393e91f7a"; // 🔒 Use env in prod!
const deepgram = createClient(apiKey);

// 🎯 Start the Agent
const agent = async () => {
  console.log("🧠 Initializing Deepgram Agent...");

  let audioBuffer = Buffer.alloc(0);
  let i = 0;

  const connection = deepgram.agent();
  globalThis.agentConnection = connection;

  // ✅ Deepgram connection established
  connection.on(AgentEvents.Welcome, () => {
    console.log("✅ Deepgram sent Welcome event");

    console.log("🛠️ Configuring Agent...");
    connection.configure({
      audio: {
        input: {
          encoding: "linear16",
          sample_rate: 16000,
        },
        output: {
          encoding: "linear16",
          sample_rate: 16000,
          container: "wav",
        },
      },
      agent: {
        language: "en",
        listen: {
          provider: {
            type: "deepgram",
            model: "nova-3",
          },
        },
        think: {
          provider: {
            type: "open_ai",
            model: "gpt-4o-mini",
          },
          prompt: "You are a friendly AI assistant.",
        },
        speak: {
          provider: {
            type: "deepgram",
            model: "aura-2-thalia-en",
          },
        },
        greeting: "Hello! How can I help you today?",
      },
    });

    console.log("🎯 Agent configured and ready!");

    // 🔁 Keep-alive ping every 4s
    setInterval(() => {
      console.log("📡 Sending keep-alive ping to Deepgram...");
      connection.keepAlive();
    }, 4000);
  });

  connection.on(AgentEvents.Open, () => {
    console.log("🟢 WebSocket connection with Deepgram opened");
  });

  connection.on(AgentEvents.Close, () => {
    console.log("🔴 WebSocket connection with Deepgram closed");
    process.exit(0);
  });

  // ✉️ Agent sends text response
  connection.on(AgentEvents.ConversationText, async (data) => {
    const actualText = data?.text || data?.content;
    if (!actualText) {
      console.warn("⚠️ ConversationText received without valid text:", data);
      return;
    }

    console.log("📝 Agent replied:", actualText);
    await appendFile(join(__dirname, `chatlog.txt`), JSON.stringify(data) + "\n");

    clients.forEach(ws => {
      ws.send(JSON.stringify({ text: actualText }));
    });
  });

  // 🛑 Interrupt agent audio if user starts speaking
  connection.on(AgentEvents.UserStartedSpeaking, () => {
    if (audioBuffer.length) {
      console.log("🔁 User started speaking - interrupting agent audio");
      audioBuffer = Buffer.alloc(0);
    }
  });

  // 🎧 Agent audio chunks received
  connection.on(AgentEvents.Audio, (data) => {
    console.log("🔊 Received agent audio chunk...");
    const buffer = Buffer.from(data);
    audioBuffer = Buffer.concat([audioBuffer, buffer]);
  });

  // ✅ Agent finished speaking
  connection.on(AgentEvents.AgentAudioDone, async () => {
    console.log("✅ Agent finished speaking, audio length:", audioBuffer.length);

    // Convert to WAV
    const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
    const wavBuffer = wav.encode([samples], { sampleRate: 16000, float: false, bitDepth: 16 });

    const filename = join(__dirname, `output-${i}.wav`);
    console.log("💾 Saving agent audio to file:", filename);
    await writeFile(filename, wavBuffer);

    const audioBase64 = fs.readFileSync(filename).toString('base64');
    console.log("📤 Sending base64 audio to frontend");

    clients.forEach(ws => {
      ws.send(JSON.stringify({ audio: audioBase64 }));
    });

    audioBuffer = Buffer.alloc(0);
    i++;
  });

  // ❌ Error from Deepgram
  connection.on(AgentEvents.Error, (err) => {
    console.error("❌ Error from Deepgram Agent:", err.message);
    console.error(JSON.stringify(err, null, 2));
  });

  // ⚠️ Unknown event
  connection.on(AgentEvents.Unhandled, (data) => {
    console.warn("⚠️ Unhandled event from Deepgram:", data);
  });
};

console.log("🚀 Starting Deepgram Voice Agent...");
void agent();

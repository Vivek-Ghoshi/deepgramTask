const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const { Deepgram } = require("@deepgram/sdk");
const { PassThrough } = require("stream");
const textToSpeech = require("@google-cloud/text-to-speech");
const { Readable } = require("stream");
const serverless = require("@vendia/serverless-express");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

const deepgram = new Deepgram("a137455db849d6721c9062dcea1b71442af62613");
const gTTSClient = new textToSpeech.TextToSpeechClient();

io.on("connection", (socket) => {
  console.log("User connected");

  const micStream = new PassThrough();

  const dgSocket = deepgram.transcription.live({
    punctuate: true,
    model: "nova",
    language: "en-US",
  });

  dgSocket.addListener("transcriptReceived", async (data) => {
    const transcript = JSON.parse(data)?.channel?.alternatives[0]?.transcript;
    if (transcript && transcript.length > 0) {
      const botReply = `You said: ${transcript}`;
      const [ttsResponse] = await gTTSClient.synthesizeSpeech({
        input: { text: botReply },
        voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" },
        audioConfig: { audioEncoding: "LINEAR16" },
      });

      socket.emit("bot-response", {
        text: botReply,
        audioBuffer: ttsResponse.audioContent,
      });
    }
  });

  dgSocket.addListener("error", (err) => {
    console.error("Deepgram error:", err);
  });

  micStream.pipe(dgSocket);

  socket.on("user-speech", (buffer) => {
    micStream.write(Buffer.from(buffer), "binary");
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
    micStream.end();
    dgSocket.finish();
  });
});

server.listen(5000, () => console.log("Server running on port 5000"));

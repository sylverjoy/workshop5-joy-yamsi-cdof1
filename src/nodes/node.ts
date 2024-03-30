import bodyParser from "body-parser";
import express from "express";
import axios from "axios"; // Import axios for HTTP requests
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import { delay } from "../utils";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let state: NodeState = {
    killed: false,
    x: initialValue,
    decided: null,
    k: null
  };

  let messages: Value[] = []; // Buffer for received messages
  let round = 0; // Current round of the algorithm

  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty === true) {
      res.status(500).send('faulty');
    } else {
      res.status(200).send('live');
    }
  });

  // this route allows the node to receive messages from other nodes
  node.post("/message", (req, res) => {
    const { message } = req.body;
    messages.push(message);
    res.sendStatus(200);
  });

  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    if (!nodesAreReady()) {
      res.status(500).send('Not all nodes are ready yet.');
      return;
    }

    round = 0;
    state.x = initialValue;
    state.decided = null;

    // Start the first round of the algorithm
    if (round === 0) {
      const v = Math.random() >= 0.5 ? 1 : 0; // Randomly choose initial value
      state.x = v;
      messages = [];
      broadcast(`/message`, { message: v });
    }

    // Run the Ben-Or algorithm
    while (round <= F * 2) {
      await delay(100); // Delay to allow messages to propagate
      if (messages.length === 0) continue; // Wait for messages
      const received = messages.pop() as Value;
      if (received !== state.x) {
        state.x = "?"; // Indicate uncertainty
      }
      round++;
    }

    state.decided = true;
    state.k = round;

    res.sendStatus(200);
  });

  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    round = -1; // Stop any further activity
    res.sendStatus(200);
  });

  // get the current state of a node
  node.get("/getState", (req, res) => {
    if (isFaulty === true) {
      state.x = null;
      state.decided = null;
      state.k = null;
    }

    res.json(state);
  });

  // Broadcast message to all nodes except itself
  function broadcast(path: string, data: any) {
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        const port = BASE_NODE_PORT + i;
        const url = `http://localhost:${port}${path}`;
        axios.post(url, data).catch(err => console.error(err));
      }
    }
  }

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}

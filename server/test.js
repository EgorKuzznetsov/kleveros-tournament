import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const key = process.env.CHALLONGE_API_KEY;
const auth = "Basic " + Buffer.from(key + ":X").toString("base64");

const url = "https://api.challonge.com/v1/tournaments.json";

const resp = await fetch(url, { headers: { Authorization: auth } });
const text = await resp.text();
console.log("Status:", resp.status);
console.log(text);
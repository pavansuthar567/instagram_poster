const express = require("express");
const app = express();
const Instagram = require("instagram-web-api");
const jimp = require("jimp");
const fs = require("fs");
const cron = require("node-cron");
const imaps = require("imap-simple");
const _ = require("lodash");
const simpleParser = require("mailparser").simpleParser;
const firebase = require("firebase-admin");
const admin = require("firebase-admin/app");
var serviceAccount = require("./serviceAccountKey.json");
var Imap = require("imap");
var MailParser = require("mailparser").MailParser;
var Promise = require("bluebird");
Promise.longStackTraces();

admin.initializeApp({
  credential: admin.cert(serviceAccount),
  databaseURL:
    "https://insta-auto-de442-default-rtdb.asia-southeast1.firebasedatabase.app",
});

require("dotenv").config();

const port = process.env.PORT || 4000;
let answerCode;

// console.log("firebase", firebase, admin);

const readline = require("readline");
const { google } = require("googleapis");

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = "token.json";

let oAuth2Client;
/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
async function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.web;
  // const {client_secret, client_id, redirect_uris} = credentials.installed;

  oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("Authorize this app by visiting this url:", authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error("Error retrieving access token", err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log("Token stored to", TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function getAnswerCode(auth) {
  const gmail = google.gmail({ version: "v1", auth });
  let messageId;

  const query = "label:inbox From:Instagram <security@mail.instagram.com>";

  await gmail.users.messages.list(
    {
      userId: "me",
      q: query,
    },
    async (err, res) => {
      if (err) return console.log("The API returned an error: " + err);
      const messages = res.data;
      messageId = messages?.messages?.[0]?.id;
      await gmail.users.messages.get(
        {
          userId: "me",
          id: messageId,
        },
        (err, res) => {
          if (err) return console.log("The API returned an error: =====" + err);
          const messageBody = res.data;
          const answerCodeArr = messageBody?.snippet
            ?.split(" ")
            ?.filter(
              (item) => item && /^\S+$/.test(item) && !isNaN(Number(item))
            );
          answerCode = answerCodeArr[0];
          console.log(answerCode);
          console.log("answerCode", answerCode);
        }
      );
    }
  );
}

const getNextPostNumber = async () => {
  try {
    let data = "";
    const db = firebase.database();
    const nextPostRef = db.ref("nextPostData");
    await nextPostRef.once("value").then(function (snapshot) {
      data = snapshot.val();
    });
    // console.log("getNextPostNumber", data);
    return data?.nextPostIndex;
  } catch (error) {
    console.log("error - could not get next post number", error);
  }
};

const updateNextPostNumber = async (nextPostIndex) => {
  try {
    const db = firebase.database();
    const nextPostRef = db.ref("nextPostData");
    nextPostRef.update(
      {
        nextPostIndex: nextPostIndex,
      },
      (error) => {
        if (error) {
          console.log("Next post number could not be updated." + error);
        } else {
          console.log("Next post number updated successfully.");
        }
      }
    );
  } catch (error) {
    console.log("error", error);
  }
};

const getData = async () => {
  try {
    let data = {};
    const db = firebase.database();
    const postRef = db.ref("postdata");
    await postRef.once("value").then(function (snapshot) {
      data = snapshot.val();
    });
    // console.log("getData", data);
    return data;
  } catch (error) {
    console.log("error", error);
  }
};

console.log("out cron");

// cron.schedule("*/5 * * * *", async () => {
// setTimeout(async () => {
try {
  console.log("in cron");
  const instagramLoginFunction = async () => {
    const client = new Instagram(
      {
        username: process.env.INSTAGRAM_USERNAME,
        password: process.env.INSTAGRAM_PASSWORD,
      },
      {
        language: "en-US",
        proxy:
          process.env.NODE_ENV === "production"
            ? process.env.FIXIE_URL
            : undefined,
      }
    );

    const nextPostNumber = await getNextPostNumber();
    const postData = await getData();

    let nextPostUrl = "";
    if (postData?.length > 0 && postData?.length >= nextPostNumber)
      nextPostUrl = postData[nextPostNumber]?.postURL;

    console.log(
      "nextPostUrl",
      nextPostUrl,
      "nextPostNumber",
      nextPostNumber
      // "postData",
      // postData
    );

    const instagramPostPictureFunction = async () => {
      jimp
        .read(nextPostUrl)
        .then((lenna) => {
          return lenna
            .resize(800, 800, jimp.RESIZE_NEAREST_NEIGHBOR)
            .quality(100)
            .write(`./post${nextPostNumber}.jpg`, async () => {
              await client
                .uploadPhoto({
                  photo: `post${nextPostNumber}.jpg`,
                  caption:
                    "follow @factbyuniverse for more such facts \r\n #fact #factbyuniverse",
                  post: "feed",
                })
                .then(async ({ media }) => {
                  console.log(`https://www.instagram.com/p/${media.code}`);

                  await updateNextPostNumber(nextPostNumber + 1);
                  fs.unlinkSync(`post${nextPostNumber}.jpg`);
                });
            });
        })
        .catch((err) => console.log("err", err));
    };

    try {
      console.log("Logging In...");

      const loginRes = await client.login();

      console.log("Login Successful! loginRes", loginRes);

      const delayedInstagramPostFunction = async (timeout) => {
        setTimeout(async () => {
          await instagramPostPictureFunction();
        }, timeout);
      };

      if (loginRes?.authenticated) await delayedInstagramPostFunction(5000);
    } catch (err) {
      console.log("Login failed!");

      if (err.status === 403) {
        console.log("Throttled!");

        return;
      }

      console.log("err.error", err.error, "err", err);

      if (err.error && err.error.message === "checkpoint_required") {
        const challengeUrl = err.error.checkpoint_url;

        await client.updateChallenge({ challengeUrl, choice: 1 });

        const delayedEmailFunction = async (timeout) => {
          try {
            setTimeout(async () => {
              // Load client secrets from a local file.
              fs.readFile("credentials.json", (err, content) => {
                if (err)
                  return console.log("Error loading client secret file:", err);
                // Authorize a client with credentials, then call the Gmail API.
                authorize(JSON.parse(content), getAnswerCode);
              });

              await client.updateChallenge({
                challengeUrl,
                securityCode: answerCode,
              });

              console.log(
                `Answered Instagram security challenge with answer code: ${answerCode}`
              );

              await client.login();

              await instagramPostPictureFunction();
            }, timeout);
          } catch (error) {
            console.log("imaps error", error);
          }
        };
        await delayedEmailFunction(1000);
      }
    }
  };
  instagramLoginFunction();
} catch (error) {
  console.log("error", error);
}
// });
// }, 1000);

app.get("/", async function (req, res) {
  res.send("API is working properly");
});

app.get("/test", async function (req, res) {
  res.send("API is working properly again");
});

app.listen(port, () => {
  console.log(`Listening on port ${port}...`);
});

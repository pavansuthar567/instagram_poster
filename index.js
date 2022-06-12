const express = require("express");
const app = express();
const Instagram = require("./instagram-web-api/index");
const FileCookieStore = require("tough-cookie-filestore2");
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

  const query =
    "label:inbox From:Instagram <security@mail.instagram.com> To:pavan.suthar567@gmail.com Subject:(Verify your account) If this was you, please use the following code to confirm your identity:";

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
          console.log("messages", messages);
          const answerCodeArr = messageBody?.snippet
            ?.split(" ")
            ?.filter(
              (item) => item && /^\S+$/.test(item) && !isNaN(Number(item))
            );
          answerCode = answerCodeArr[0];
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

const instagramLoginFunction = async () => {
  // Persist cookies after Instagram client log in
  const cookieStore = new FileCookieStore("./cookies.json");

  const client = new Instagram(
    {
      username: process.env.INSTAGRAM_USERNAME,
      password: process.env.INSTAGRAM_PASSWORD,
      cookieStore,
    },
    {
      language: "en-US",
      // proxy:
      //   process.env.NODE_ENV === "production"
      //     ? process.env.FIXIE_URL
      //     : undefined,
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
    if (!nextPostUrl) return;
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

    if (loginRes?.authenticated) await delayedInstagramPostFunction(10000);
  } catch (err) {
    console.log("Login failed!");

    const delayedLoginFunction = async (timeout) => {
      setTimeout(async () => {
        await client.login().then(() => instagramPostPictureFunction());
      }, timeout);
    };

    if (err.statusCode === 403 || err.statusCode === 429) {
      console.log("Throttled!");

      await delayedLoginFunction(10000);
    }

    console.log("err.error", err.error);

    if (err.error && err.error.message === "checkpoint_required") {
      const challengeUrl = err.error.checkpoint_url;

      // const updateChallenge =
      await client.updateChallenge({
        challengeUrl,
        choice: 1,
      });

      console.log(
        "inside checkpoint_required",
        process.env.USER_EMAIL,
        process.env.USER_PASSWORD
        // updateChallenge
      );
      // const emailConfig = {
      //   imap: {
      //     user: `${process.env.USER_EMAIL}`,
      //     password: `${process.env.USER_PASSWORD}`,
      //     host: "imap.gmail.com",
      //     port: 993,
      //     tls: true,
      //     tlsOptions: {
      //       servername: "imap.gmail.com",
      //       rejectUnauthorized: false,
      //     },
      //     authTimeout: 30000,
      //   },
      // };

      const delayedEmailFunction = async (timeout) => {
        try {
          setTimeout(async () => {
            // Load client secrets from a local file.
            await fs.readFile("credentials.json", async (err, content) => {
              if (err)
                return console.log("Error loading client secret file:", err);
              // Authorize a client with credentials, then call the Gmail API.
              await authorize(JSON.parse(content), getAnswerCode);

              if (answerCode) {
                await client.updateChallenge({
                  challengeUrl,
                  securityCode: answerCode,
                });
              }
              console.log(
                `Answered Instagram security challenge with answer code: ${answerCode}`
              );
              await client.login();
              await instagramPostPictureFunction();
            });
            // imaps.connect(emailConfig).then(async (connection) => {
            //   return connection.openBox("INBOX").then(async () => {
            //     // Fetch emails from the last hour
            //     const delay = 1 * 3600 * 1000;
            //     let lastHour = new Date();
            //     lastHour.setTime(Date.now() - delay);
            //     lastHour = lastHour.toISOString();
            //     const searchCriteria = ["ALL", ["SINCE", lastHour]];
            //     const fetchOptions = {
            //       bodies: [""],
            //     };
            //     return connection
            //       .search(searchCriteria, fetchOptions)
            //       .then((messages) => {
            //         messages.forEach((item) => {
            //           const all = _.find(item.parts, { which: "" });
            //           const id = item.attributes.uid;
            //           const idHeader = "Imap-Id: " + id + "\r\n";
            //           simpleParser(
            //             idHeader + all.body,
            //             async (err, mail) => {
            //               if (err) {
            //                 console.log(err);
            //               }
            //               console.log(mail.subject);
            //               const answerCodeArr = mail.text
            //                 .split("\n")
            //                 .filter(
            //                   (item) =>
            //                     item &&
            //                     /^\S+$/.test(item) &&
            //                     !isNaN(Number(item))
            //                 );
            //               if (mail.text.includes("Instagram")) {
            //                 if (answerCodeArr.length > 0) {
            //                   // Answer code must be kept as string type and not manipulated to a number type to preserve leading zeros
            //                   const answerCode = answerCodeArr[0];
            //                   console.log(answerCode);
            //                   await client.updateChallenge({
            //                     challengeUrl,
            //                     securityCode: answerCode,
            //                   });
            //                   console.log(
            //                     `Answered Instagram security challenge with answer code: ${answerCode}`
            //                   );
            //                   await client.login();
            //                   await instagramPostPictureFunction();
            //                 }
            //               }
            //             }
            //           );
            //         });
            //       });
            //   });
            // });
          }, timeout);
        } catch (error) {
          console.log("imaps error", error);
        }
      };
      await delayedEmailFunction(5000);
    }
    // Delete stored cookies, if any, and log in again
    console.log("Logging in again and setting new cookie store");
    fs.unlinkSync("./cookies.json");
    const newCookieStore = new FileCookieStore("./cookies.json");

    const newClient = new Instagram(
      {
        username: process.env.INSTAGRAM_USERNAME,
        password: process.env.INSTAGRAM_PASSWORD,
        cookieStore: newCookieStore,
      },
      {
        language: "en-US",
      }
    );

    const delayedNewLoginFunction = async (timeout) => {
      setTimeout(async () => {
        console.log("Logging in again");
        await newClient
          .login()
          .then(() => instagramPostPictureFunction())
          .catch((err) => {
            console.log(err);
            console.log("Login failed again!");
          });
      }, timeout);
    };

    await delayedNewLoginFunction(10000);
  }
};

// cron.schedule("*/5 * * * *", async () => { ===================================== every five minutes
// cron.schedule("* */2 * * *", async () => {
setTimeout(async () => {
  try {
    console.log("in cron");
    await instagramLoginFunction();
  } catch (error) {
    console.log("error", error);
  }
  // });
}, 1000);

app.get("/", async function (req, res) {
  res.send("API is working properly");
});

app.get("/test", async function (req, res) {
  await instagramLoginFunction();
  res.send("API is working properly again");
});

app.listen(port, () => {
  console.log(`Listening on port ${port}...`);
});

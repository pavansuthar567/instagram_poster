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

console.log("firebase", firebase, admin);

const getNextPostNumber = async () => {
  try {
    let data = "";
    const db = firebase.database();
    const nextPostRef = db.ref("nextPostData");
    await nextPostRef.once("value").then(function (snapshot) {
      data = snapshot.val();
    });
    console.log("getNextPostNumber", data);
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
    console.log("getData", data);
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
      nextPostNumber,
      "postData",
      postData
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

    // try {
    //   console.log("Logging In...");

    //   const loginRes = await client.login();

    //   console.log("Login Successful! loginRes", loginRes);

    //   const delayedInstagramPostFunction = async (timeout) => {
    //     setTimeout(async () => {
    //       await instagramPostPictureFunction();
    //     }, timeout);
    //   };

    //   await delayedInstagramPostFunction(5000);
    // } catch (err) {
    // console.log("Login failed!");

    // if (err.status === 403) {
    //   console.log("Throttled!");

    //   return;
    // }

    // console.log(err.error);

    // if (err.error && err.error.message === "checkpoint_required") {
    const challengeUrl =
      // err.error.checkpoint_url ||
      "/challenge/action/AXH6WTQ6dTU71SeFitKLK8v01EQUNFUS-LEXN61uLpaXTk-rBXmTYQA94R7RZcaZGNQfHQo/Egbthap7HUMo3AT0/ffc_y69WUKVMSw8qcoVbcQCAQXKmjOPoJBSAbSIFIDzRvFGI6KNfhIOyG4uG4LaNHeRR/";

    // await client.updateChallenge({ challengeUrl, choice: 1 });

    const emailConfig = {
      user: `${process.env.USER_EMAIL}`,
      password: `${process.env.USER_PASSWORD}`,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: {
        servername: "imap.gmail.com",
        rejectUnauthorized: "false",
      },
      authTimeout: 30000,
    };

    const delayedEmailFunction = async (timeout) => {
      try {
        setTimeout(async () => {
          console.log("emailConfig");
          var imap = new Imap(emailConfig);
          Promise.promisifyAll(imap);

          imap.once("ready", execute);
          imap.once("error", function (err) {
            console.log("Connection error: " + err.stack);
          });
          imap.connect();

          function execute() {
            imap.openBox("INBOX", false, function (err, mailBox) {
              if (err) {
                console.error(err);
                return;
              }
              imap.search(["UNSEEN"], function (err, results) {
                if (!results || !results.length) {
                  console.log("No unread mails");
                  imap.end();
                  return;
                }
                /* mark as seen
                    imap.setFlags(results, ['\\Seen'], function(err) {
                        if (!err) {
                            console.log("marked as read");
                        } else {
                            console.log(JSON.stringify(err, null, 2));
                        }
                    });*/

                var f = imap.fetch(results, { bodies: "" });
                f.on("message", processMessage);
                f.once("error", function (err) {
                  return Promise.reject(err);
                });
                f.once("end", function () {
                  console.log("Done fetching all unseen messages.");
                  imap.end();
                });
              });
            });
          }

          function processMessage(msg, seqno) {
            console.log("Processing msg #" + seqno);
            // console.log(msg);

            var parser = new MailParser();
            parser.on("headers", function (headers) {
              console.log("Header: " + JSON.stringify(headers));
            });

            parser.on("data", (data) => {
              if (data.type === "text") {
                console.log(seqno);
                console.log(data.text); /* data.html*/
              }

              // if (data.type === 'attachment') {
              //     console.log(data.filename);
              //     data.content.pipe(process.stdout);
              //     // data.content.on('end', () => data.release());
              // }
            });

            msg.on("body", function (stream) {
              stream.on("data", function (chunk) {
                parser.write(chunk.toString("utf8"));
              });
            });
            msg.once("end", function () {
              // console.log("Finished msg #" + seqno);
              parser.end();
            });
          }

          // imaps.connect(emailConfig).then(async (connection) => {
          //   return connection.openBox("INBOX").then(() => {
          //     const delay = 1 * 3600 * 1000;
          //     let lastHour = new Date();
          //     lastHour.setTime(Date.now() - delay);
          //     lastHour = lastHour.toISOString();
          //     const searchCriteria = ["ALL", "SINCE", lastHour];
          //     const fetchOptions = {
          //       bodies: [""],
          //     };
          //     return connection
          //       .search(searchCriteria, fetchOptions)
          //       .then((messages) => {
          //         console.log("messages", messages);
          //         messages.forEach((item) => {
          //           const all = _.find(item.parts, { which: "" });
          //           const id = item.attributes.uid;
          //           const idHeader = "Imap-Id: " + id + "\r\n";

          //           simpleParser(idHeader + all.body, async (err, mail) => {
          //             if (err) console.log(err);

          //             console.log(mail.subject);

          //             const answerCodeArr = mail.text
          //               .split("\n")
          //               .filter(
          //                 (item) =>
          //                   item && /^\S+$/.test(item) && !isNaN(Number(item))
          //               );

          //             if (mail.text.includes("Instagram")) {
          //               if (answerCodeArr.length > 0) {
          //                 // Answer code must be kept as string type and not manipulated to a number type to preserve leading zeros
          //                 const answerCode = answerCodeArr[0];
          //                 console.log(answerCode);

          //                 await client.updateChallenge({
          //                   challengeUrl,
          //                   securityCode: answerCode,
          //                 });

          //                 console.log(
          //                   `Answered Instagram security challenge with answer code: ${answerCode}`
          //                 );

          //                 await client.login();

          //                 await instagramPostPictureFunction();
          //               }
          //             }
          //           });
          //         });
          //       });
          //   });
          // });
        }, timeout);
      } catch (error) {
        console.log("imaps error", error);
      }
    };
    await delayedEmailFunction(1000);
  };
  // };
  // };
  instagramLoginFunction();
} catch (error) {
  console.log("error", error);
}
// });
// }, 1000);

app.get("/", async function (req, res) {
  res.send("API is working properly");
  // .json({ message: "Success" });+++++++++
});

app.get("/test", async function (req, res) {
  res.send("API is working properly again");
  // .json({ message: "Success" });+++++++++
});

app.listen(port, () => {
  console.log(`Listening on port ${port}...`);
});

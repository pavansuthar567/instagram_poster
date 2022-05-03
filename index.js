const express = require("express");
const app = express();
const Instagram = require("instagram-web-api");
const jimp = require("jimp");
const fs = require("fs");
const cron = require("node-cron");
const imaps = require("imap-simple");
const _ = require("lodash");
// const simpleParser = require("mailparser").simpleParser;
const firebase = require("firebase-admin");
const admin = require("firebase-admin/app");
var serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.cert(serviceAccount),
  databaseURL:
    "https://insta-auto-de442-default-rtdb.asia-southeast1.firebasedatabase.app",
});

require("dotenv").config();

const port = process.env.PORT || 4000;

const getNextPostNumber = async () => {
  try {
    let data = "";
    const db = firebase.database();
    const nextPostRef = db.ref("nextPostData");
    await nextPostRef.once("value").then(function (snapshot) {
      data = snapshot.val();
    });
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
    return data;
  } catch (error) {
    console.log("error", error);
  }
};

cron.schedule("59 14 * * *", async () => {
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

      await client.login();

      console.log("Login Successful!");

      const delayedInstagramPostFunction = async (timeout) => {
        setTimeout(async () => {
          await instagramPostPictureFunction();
        }, timeout);
      };

      await delayedInstagramPostFunction(5000);
    } catch (err) {
      console.log("Login failed!");

      if (err.status === 403) {
        console.log("Throttled!");

        return;
      }

      console.log(err.error);

      if (err.error && err.error.message === "checkpoint_required") {
        const challengeUrl = err.error.checkpoint_url;

        await client.updateChallenge({ challengeUrl, choice: 1 });

        const emailConfig = {
          imp: {
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
          },
        };

        // const delayedEmailFunction = async (timeout) => {
        //   try {
        //     setTimeout(async () => {
        //       imaps.connect(emailConfig).then(async (connection) => {
        //         return connection.openBox("INBOX").then(() => {
        //           const delay = 1 * 3600 * 1000;
        //           let lastHour = new Date();
        //           lastHour.setTime(Date.now() - delay);
        //           lastHour = lastHour.toISOString();
        //           const searchCriteria = ["ALL", "SINCE", lastHour];
        //           const fetchOptions = {
        //             bodies: [""],
        //           };
        //           return connection
        //             .search(searchCriteria, fetchOptions)
        //             .then((messages) => {
        //               console.log("messages", messages);
        //               messages.forEach((item) => {
        //                 const all = _.find(item.parts, { which: "" });
        //                 const id = item.attributes.uid;
        //                 const idHeader = "Imap-Id: " + id + "\r\n";

        //                 simpleParser(idHeader + all.body, async (err, mail) => {
        //                   if (err) console.log(err);

        //                   console.log(mail.subject);

        //                   const answerCodeArr = mail.text
        //                     .split("\n")
        //                     .filter(
        //                       (item) =>
        //                         item &&
        //                         /^\S+$/.test(item) &&
        //                         !isNaN(Number(item))
        //                     );

        //                   if (mail.text.includes("Instagram")) {
        //                     if (answerCodeArr.length > 0) {
        //                       // Answer code must be kept as string type and not manipulated to a number type to preserve leading zeros
        //                       const answerCode = answerCodeArr[0];
        //                       console.log(answerCode);

        //                       await client.updateChallenge({
        //                         challengeUrl,
        //                         securityCode: answerCode,
        //                       });

        //                       console.log(
        //                         `Answered Instagram security challenge with answer code: ${answerCode}`
        //                       );

        //                       await client.login();

        //                       await instagramPostPictureFunction();
        //                     }
        //                   }
        //                 });
        //               });
        //             });
        //         });
        //       });
        //     }, timeout);
        //   } catch (error) {
        //     console.log("imaps error", error);
        //   }
        // };
        // await delayedEmailFunction(45000);
      }
    }
  };
  await instagramLoginFunction();
});

app.get("/", async function (req, res) {
  res.send("API is working properly").json({ message: "Success" });
});

app.listen(port, () => {
  console.log(`Listening on port ${port}...`);
});

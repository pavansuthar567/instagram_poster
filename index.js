const express = require("express");
const app = express();
const Instagram = require("./instagram-web-api/index");
const FileCookieStore = require("tough-cookie-filestore2");
const jimp = require("jimp");
const fs = require("fs");
const cron = require("node-cron");
// const imaps = require("imap-simple");
const _ = require("lodash");
// const simpleParser = require("mailparser").simpleParser;
const firebase = require("firebase-admin");
const admin = require("firebase-admin/app");
var serviceAccount = require("./serviceAccountKey.json");
// var Imap = require("imap");
// var MailParser = require("mailparser").MailParser;
var Promise = require("bluebird");
Promise.longStackTraces();
// var http = require("http");
const request = require("request");

const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

admin.initializeApp({
  credential: admin.cert(serviceAccount),
  databaseURL:
    "https://insta-auto-de442-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "insta-auto-de442.appspot.com",
});

require("dotenv").config();

const port = process.env.PORT || 4000;
let answerCode;

// console.log("firebase", firebase, admin);

const readline = require("readline");
const { google } = require("googleapis");
const { getMultipleRandom } = require("./global/helpers");
const { hashTags } = require("./data/raw");

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

const getNextPostNumber = async (selectedPage) => {
  try {
    let data = "";
    const db = firebase.database();
    const nextPostRef = db.ref(`${selectedPage}/nextPostIndex`);
    await nextPostRef.once("value").then(function (snapshot) {
      data = snapshot.val();
    });
    // console.log("getNextPostNumber", data);
    return data || 0;
  } catch (error) {
    console.log("error - could not get next post number", error);
  }
};

const updateNextPostNumber = async (nextPostIndex, selectedPage) => {
  try {
    const db = firebase.database();
    const nextPostRef = db.ref(selectedPage);
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

const getData = async (nextPostNumber, selectedPage) => {
  try {
    let data = {};
    const db = firebase.database();
    const postRef = db.ref(`${selectedPage}/postData/${nextPostNumber}`);
    await postRef.once("value").then(function (snapshot) {
      data = snapshot.val();
    });
    // console.log("getData", data);
    return data;
  } catch (error) {
    console.log("error", error);
  }
};

const INSTA_PAGES_ID = {
  FACT_BY_UNIVERSE: "Fact_By_Universe",
  FACT_BY_UNIVERSE_HINDI: "Fact_By_Universe_Hindi",
  PAVAN_SUTHAR: "Pavan_Suthar",
  COMEDY_WRITER_13: "Comedy_Writer_13",
  CHANAKYA_GANGA: "Chanakya_Ganga",
};

const getInstaCredentials = (selectedPage) => {
  let credentials = undefined;
  switch (selectedPage) {
    case INSTA_PAGES_ID.FACT_BY_UNIVERSE:
      credentials = {
        username: "factbyuniverse",
        password: "Pavan@100",
        cookieFileName: "cookies",
      };
      break;

    case INSTA_PAGES_ID.FACT_BY_UNIVERSE_HINDI:
      credentials = {
        username: "factbyuniversehindi",
        password: "Pavan.100",
        cookieFileName: "cookies1",
      };
      break;

    case INSTA_PAGES_ID.PAVAN_SUTHAR:
      credentials = {
        username: "pavan_suthar13",
        password: "Pavan.100",
        cookieFileName: "cookies2",
      };
      break;

    case INSTA_PAGES_ID.COMEDY_WRITER_13:
      credentials = {
        username: "comedy_writer_13",
        password: "Pavan.100",
        cookieFileName: "cookies3",
      };
      break;

    case INSTA_PAGES_ID.CHANAKYA_GANGA:
      credentials = {
        username: "chanakya_ganga",
        password: "Pavan@100",
        cookieFileName: "cookies4",
      };
      break;

    default:
      credentials = {
        username: "factbyuniverse",
        password: "Pavan.100",
        cookieFileName: "cookies",
      };
      break;
  }
  return credentials;
};

const instagramLoginFunction = async (selectedPage) => {
  // Persist cookies after Instagram client log in
  const instaCredentials = getInstaCredentials(selectedPage);
  const { username, password, cookieFileName } = instaCredentials || {};
  const cookieStore = new FileCookieStore(`./${cookieFileName}.json`);

  const client = new Instagram(
    {
      username: username,
      password: password,
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

  const nextPostNumber = await getNextPostNumber(selectedPage);
  const postData = await getData(nextPostNumber, selectedPage);

  let nextPostUrl = "";
  let hashtagStr = "";
  if (postData?.postURL) {
    nextPostUrl = postData?.postURL;
    hashtagStr = postData?.hashtagStr;
  }

  console.log("nextPostUrl", nextPostUrl, "nextPostNumber1", nextPostNumber);

  // const imageHeight =
  //   selectedPage === INSTA_PAGES_ID.FACT_BY_UNIVERSE ? 1350 : 1080;

  const defaultHashTagsStr = hashtagStr || "";
  const defaultHashTags = defaultHashTagsStr.split(" ");
  const tagsArr = getMultipleRandom(
    selectedPage === INSTA_PAGES_ID.CHANAKYA_GANGA
      ? hashTags.chanakyaHashtags
      : hashTags.factHashtags,
    25 - defaultHashTags.length
  );

  let tags = "";
  if (tagsArr?.length > 0) tags = tagsArr.join(" ");

  const instagramPostPictureFunction = async () => {
    if (!nextPostUrl) return;
    jimp
      .read(nextPostUrl)
      .then((lenna) => {
        return lenna
          .resize(1080, 1080, jimp.RESIZE_NEAREST_NEIGHBOR)
          .quality(100)
          .write(`./post${nextPostNumber}.jpg`, async () => {
            await client
              .uploadPhoto({
                photo: `post${nextPostNumber}.jpg`,
                caption: `Follow @${username}, 👉TURN ON POST NOTIFICATION TO NEVER MISS AN UPDATE FROM US😊
                          .
                          .
                          🔥Follow 
                          @factbyuniverse 🔥 
                          @factbyuniversehindi 🔥 
                          @comedy_writer_13 🔥
                          @chanakya_ganga 🔥
                          .
                          .
                          for most amazing facts and science videos
                          .
                          .
                          💗Like, Comment, Follow 💗
                          #fact #factbyuniverse
                          ${tags}`,
                post: "feed",
              })
              .then(async ({ media }) => {
                console.log(`https://www.instagram.com/p/${media.code}`);

                await updateNextPostNumber(nextPostNumber + 1, selectedPage);
                fs.unlinkSync(`post${nextPostNumber}.jpg`);
              });
          });
      })
      .catch((err) => console.log("err", err));
  };

  try {
    console.log("Logging In...");

    const loginRes = await client.login();

    console.log("Login Response", loginRes);

    const delayedInstagramPostFunction = async (timeout) => {
      setTimeout(async () => {
        await instagramPostPictureFunction(selectedPage);
      }, timeout);
    };

    if (loginRes?.authenticated) await delayedInstagramPostFunction(10000);
  } catch (err) {
    console.log("Login failed!", err);

    const delayedLoginFunction = async (timeout) => {
      setTimeout(async () => {
        await client
          .login()
          .then(() => instagramPostPictureFunction(selectedPage));
      }, timeout);
    };

    if (err.statusCode === 403 || err.statusCode === 429) {
      console.log("Throttled!");

      await delayedLoginFunction(10000);
    }

    console.log("err.error", err.error);

    if (err.error && err.error.message === "checkpoint_required") {
      let challengeUrl = err.error.checkpoint_url;
      if (challengeUrl) challengeUrl = challengeUrl.substring(25);

      await client.updateChallenge({
        challengeUrl,
        choice: 1,
      });

      console.log("inside checkpoint_required");

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
              await instagramPostPictureFunction(selectedPage);
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
    fs.unlinkSync(`./${cookieFileName}.json`);
    const newCookieStore = new FileCookieStore(`./${cookieFileName}.json`);

    const newClient = new Instagram(
      {
        username: username,
        password: password,
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
          .then(() => instagramPostPictureFunction(selectedPage))
          .catch((err) => {
            console.log("err", err);
            console.log("Login failed again!");
          });
      }, timeout);
    };

    await delayedNewLoginFunction(10000);
  }
};

cron.schedule("50 6,9,12,15 * * *", async () => {
  // cron.schedule("39 9,15 * * *", async () => {
  setTimeout(async () => {
    try {
      console.log("in cron", new Date());
      await instagramLoginFunction(INSTA_PAGES_ID.FACT_BY_UNIVERSE);
    } catch (error) {
      console.log("error", error);
    }
  }, 1000);
});

cron.schedule("40 6,9,12,15 * * *", async () => {
  setTimeout(async () => {
    try {
      console.log("in cron", new Date());
      await instagramLoginFunction(INSTA_PAGES_ID.CHANAKYA_GANGA);
    } catch (error) {
      console.log("error", error);
    }
  }, 1000);
});

// cron.schedule("10 18 * * *", async () => {
//   // cron.schedule("39 9,15 * * *", async () => {
//   setTimeout(async () => {
//     try {
//       console.log("in cron", new Date());
//       await instagramLoginFunction(INSTA_PAGES_ID.FACT_BY_UNIVERSE);
//     } catch (error) {
//       console.log("error", error);
//     }
//   }, 1000);
// });

cron.schedule("29 6,12 * * *", async () => {
  setTimeout(async () => {
    try {
      console.log("in cron hindi");
      await instagramLoginFunction(INSTA_PAGES_ID.FACT_BY_UNIVERSE_HINDI);
    } catch (error) {
      console.log("error", error);
    }
  }, 1000);
});

cron.schedule("49 6,9,12,15 * * *", async () => {
  setTimeout(async () => {
    try {
      console.log("in cron pavan");
      await instagramLoginFunction(INSTA_PAGES_ID.PAVAN_SUTHAR);
    } catch (error) {
      console.log("error", error);
    }
  }, 1000);
});

cron.schedule("9 9,12,15 * * *", async () => {
  setTimeout(async () => {
    try {
      console.log("in cron comedy");
      await instagramLoginFunction(INSTA_PAGES_ID.COMEDY_WRITER_13);
    } catch (error) {
      console.log("error", error);
    }
  }, 1000);
});

app.get("/", async function (req, res) {
  res.send("API is working properly");
});

// function startKeepAlive() {
//   setInterval(function () {
//     console.log("startKeepAlive 10");
//     try {
//       var options = {
//         host: "instagram-poster.onrender.com",
//         // port: port,
//         path: "/test",
//       };
//       http
//         .get(options, function (res) {
//           res.on("data", function (chunk) {
//             try {
//               // optional logging... disable after it's working
//               console.log("HEROKU RESPONSE: 10" + chunk);
//             } catch (err) {
//               console.log(err.message);
//             }
//           });
//         })
//         .on("error", function (err) {
//           console.log("Error: get" + err.message);
//         });
//     } catch (error) {
//       console.log("keep alive error", error);
//     }
//     // }, 10000); // load every 10 minutes
//   }, 10 * 60 * 1000); // load every 10 minutes
// }

// startKeepAlive();

app.get("/test", async function (req, res) {
  console.log("test");
  res.send("API is working properly again");
  // await instagramLoginFunction(INSTA_PAGES_ID.FACT_BY_UNIVERSE);
});

app.get("/post_english", async function (req, res) {
  console.log("test");
  await instagramLoginFunction(INSTA_PAGES_ID.FACT_BY_UNIVERSE);
  res.send(
    "API is working properly - posted - INSTA_PAGES_ID.FACT_BY_UNIVERSE"
  );
});

app.get("/test_chanakya", async function (req, res) {
  console.log("test chanakya");
  await instagramLoginFunction(INSTA_PAGES_ID.CHANAKYA_GANGA);
  res.send("API is working properly - posted - INSTA_PAGES_ID.CHANAKYA_GANGA");
});

app.get("/testhindi", async function (req, res) {
  console.log("testhindi");
  await instagramLoginFunction(INSTA_PAGES_ID.FACT_BY_UNIVERSE_HINDI);
  res.send("API is working properly hindi");
});

// const uploadVideoToFirebase = () => {
//   const bucket = firebase.storage().bucket();
//   const filePath = "./output/video(1).mp4"; // replace with actual path to video file
//   const destination = "Videos/video(1).mp4"; // replace with desired destination path in storage
//   const db = firebase.database();
//   const videoRef = db.ref("videos");

//   console.log("bucket", bucket);
//   const fileStreams = bucket.getFilesStream();
//   console.log("fileStreams", fileStreams);

//   bucket
//     .upload(filePath, {
//       destination: destination,
//       metadata: {
//         contentType: "video/mp4", // set the content type of the video file
//       },
//     })
//     .then((res) => {
//       console.log("Video uploaded successfully", res);
//     })
//     .catch((error) => {
//       console.error("Error uploading video:", error);
//     })
//     .then(() => {
//       // get the download URL of the video from Firebase Storage
//       const videoFile = bucket.file("Videos/video(1).mp4");
//       return videoFile.getSignedUrl({
//         action: "read",
//         expires: "03-17-2025",
//       });
//     })
//     .then((urls) => {
//       const videoUrl = urls[0];
//       console.log("Video URL:", videoUrl);

//       // store the video URL in the Firebase Realtime Database
//       return videoRef.push({ url: videoUrl });
//     })
//     .then(() => {
//       console.log("Video URL stored in Firebase Realtime Database");
//     })
//     .catch((error) => {
//       console.error(
//         "Error storing video URL in Firebase Realtime Database:",
//         error
//       );
//     });
// };

// const convertImageToReel = () => {
//   // specify the input image URL
//   const imageUrl =
//     "https://hcti.io/v1/image/6d24ffeb-0a91-4d2f-a3e8-6041c825c6f0";

//   // specify the output video file path and name
//   const outputPath = "./output/video(1).mp4";
//   const imageFileName = "./temp/image.jpg";
//   const audioUrl =
//     "https://scontent.fstv8-1.fna.fbcdn.net/v/t39.12897-6/273298257_717374482979423_1209143018629427634_n.m4a?_nc_cat=101&ccb=1-7&_nc_sid=02c1ff&_nc_ohc=TYR3tGOM8IoAX860_-Q&_nc_ad=z-m&_nc_cid=2034&_nc_ht=scontent.fstv8-1.fna&oh=00_AfByczqhFuQrCRKyyGp2HI75c3GvgObexXDZV6j3GcR7cQ&oe=6447A6FE";
//   const audioFileName = "./temp/audio.mp3";

//   const duration = 10;
//   const width = 720;
//   const height = 1280;
//   const fps = 30;

//   const videoBitrate = "25M";
//   const audioBitrate = "128k";

//   // download image and audio files
//   request(imageUrl)
//     .pipe(fs.createWriteStream(imageFileName))
//     .on("close", () => {
//       request(audioUrl)
//         .pipe(fs.createWriteStream(audioFileName))
//         .on("close", () => {
//           // use ffmpeg to create the video
//           ffmpeg()
//             .input(imageFileName)
//             .loop(duration)
//             .input(audioFileName)
//             .outputOptions("-movflags frag_keyframe+empty_moov")
//             .outputOptions("-pix_fmt yuv420p")
//             .outputOptions("-profile:v main")
//             .outputOptions("-level 3.1")
//             .outputOptions("-g 30")
//             .outputOptions("-keyint_min 120")
//             .outputOptions("-sc_threshold 0")
//             .outputOptions("-tune fastdecode")
//             .outputOptions("-preset medium")
//             .outputOptions("-crf 18")
//             .outputOptions(`-s ${width}x${height}`)
//             .outputOptions("-maxrate 25M")
//             .outputOptions("-bufsize 25M")
//             .outputOptions("-movflags +faststart")
//             .outputOptions("-f mp4")
//             .audioCodec("aac")
//             .audioChannels(2)
//             .audioFrequency(48000)
//             .audioBitrate("128k")
//             .videoCodec("libx264")
//             .videoFilter(
//               `scale=w='min(1920,iw)':h='min(1920,ih)*min(9/16,ih/iw)':force_original_aspect_ratio=decrease`
//             )
//             .fps(fps)
//             .duration(duration)
//             .output(outputPath)
//             .on("end", () => {
//               console.log("Video conversion complete");
//             })
//             .on("error", (err) => {
//               console.log("Error while processing:", err.message);
//             })
//             .run();
//         });
//     });
// };

// // Working for reels perfectly
// // convertImageToReel();
// uploadVideoToFirebase();

app.listen(port, () => {
  console.log(`Listening on port ${port}...`);
});

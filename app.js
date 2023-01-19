//IMPORT EXPRESS JS
const express = require("express");
const twitterApp = express();
twitterApp.use(express.json());

//IMPORT SQLITE
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

//IMPORT PATH
const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");

//IMPORT BCRYPT
const bcrypt = require("bcrypt");

//IMPORT JWT
const jwt = require("jsonwebtoken");

//MAKE A DB VARIABLE
let dbConnection;

//START SERVER
const connectToDb = async () => {
  try {
    dbConnection = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    twitterApp.listen(3000, () => {
      console.log("SERVER RUNNING..........");
    });
  } catch (err) {
    console.log(`DB ERROR: ${err.message}`);
    process.exit(1);
  }
};

connectToDb();

//REGISTER USER API1
twitterApp.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `
    SELECT *
    FROM user
    WHERE username = "${username}";
  `;

  const dbUser = await dbConnection.get(getUserQuery);

  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const addUserQuery = `
            INSERT INTO user
            (username,password,name,gender)
            VALUES 
                ("${username}","${hashedPassword}","${name}","${gender}");
        `;
      await dbConnection.run(addUserQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//USER LOGIN API2
twitterApp.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `
    SELECT *
    FROM user
    WHERE username = "${username}";
  `;

  const dbUser = await dbConnection.get(getUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordSame = await bcrypt.compare(password, dbUser.password);
    if (isPasswordSame) {
      const payload = {
        userId: dbUser.user_id,
      };
      const jwtToken = jwt.sign(payload, "GANI_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//VERIFY JWT TOKEN FUNCTION
const verifyToken = async (request, response, nextFunc) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "GANI_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.userId = payload.userId;
        nextFunc();
      }
    });
  }
};

//VERIFY IF USER IS FOLLOWING THE REQUESTED USER
const verifyIfFollowing = async (request, response, nextFunc) => {
  const userId = request.userId;
  const { tweetId } = request.params;

  const followingQuery = `
        SELECT tweet_id 
        FROM tweet
        WHERE user_id IN (SELECT following_user_id	FROM follower WHERE follower_user_id = ${userId});
    `;
  const tweetIdObj = await dbConnection.all(followingQuery);
  const tweetIdArr = [];

  for (let i of tweetIdObj) {
    tweetIdArr.push(i.tweet_id);
  }

  if (tweetIdArr.includes(parseInt(tweetId))) {
    nextFunc();
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
};

//LATEST POSTS OF USERS FOLLOWED BY USER API3
twitterApp.get("/user/tweets/feed/", verifyToken, async (request, response) => {
  const userId = request.userId;
  const getLatestPostsQuery = `
    SELECT user.username,
        tweet.tweet,
        tweet.date_time AS dateTime
    FROM tweet NATURAL JOIN user 
    WHERE user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id = ${userId})
    ORDER BY 
        date_time DESC
    LIMIT 4
    OFFSET 0;
  `;

  const latestTweets = await dbConnection.all(getLatestPostsQuery);
  response.send(latestTweets);
});

//GET USERS FOLLOWED BY USER API4
twitterApp.get("/user/following/", verifyToken, async (request, response) => {
  const userId = request.userId;

  const followersQuery = `
        SELECT user.name
        FROM user INNER JOIN follower ON user.user_id = follower.following_user_id
        WHERE follower.follower_user_id = ${userId};
    `;

  const followingUsers = await dbConnection.all(followersQuery);
  response.send(followingUsers);
});

//GET USER FOLLOWING API5
twitterApp.get("/user/followers/", verifyToken, async (request, response) => {
  const userId = request.userId;

  const followersQuery = `
        SELECT name 
        FROM user
        WHERE user_id IN (SELECT follower_user_id FROM follower WHERE following_user_id = ${userId});
      `;

  const allFollowing = await dbConnection.all(followersQuery);
  response.send(allFollowing);
});

//GET TWEET OF A FOLLOWING USER
twitterApp.get(
  "/tweets/:tweetId/",
  verifyToken,
  verifyIfFollowing,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetQuery = `
        SELECT tweet.tweet,
                COUNT(like.like_id) AS likes,
                COUNT(reply.reply_id) AS replies,
                tweet.date_time AS dateTime 
        FROM tweet LEFT JOIN reply ON reply.tweet_id = tweet.tweet_id LEFT JOIN like ON like.tweet_id = tweet.tweet_id
        WHERE tweet.tweet_id = ${tweetId}
        GROUP BY
            tweet.tweet_id;
    `;

    const tweet = await dbConnection.get(getTweetQuery);
    response.send(tweet);
  }
);

//NAMES OF USERS WHO LIKED POST API7
twitterApp.get(
  "/tweets/:tweetId/likes/",
  verifyToken,
  verifyIfFollowing,
  async (request, response) => {
    const { tweetId } = request.params;

    const likesQuery = `
        SELECT user.name
        FROM like INNER JOIN user ON like.user_id = user.user_id 
        WHERE 
            like.tweet_id = ${tweetId};
    `;

    const likedNamesObj = await dbConnection.all(likesQuery);
    const likes = [];

    for (let eachObj of likedNamesObj) {
      likes.push(eachObj.name);
    }

    response.send({ likes });
  }
);

//GET REPLIES OF A TWEET API8
twitterApp.get(
  "/tweets/:tweetId/replies/",
  verifyToken,
  verifyIfFollowing,
  async (request, response) => {
    const { tweetId } = request.params;

    const getRepliesQuery = `
        SELECT user.name,reply.reply
        FROM user INNER JOIN reply ON reply.user_id = user.user_id
        WHERE reply.tweet_id = ${tweetId};
    `;

    const replies = await dbConnection.all(getRepliesQuery);
    response.send({ replies });
  }
);

//GET ALL TWEETS OF USER API9
twitterApp.get("/user/tweets/", verifyToken, async (request, response) => {
  const userId = request.userId;

  const getUserTweetsQuery = `
        SELECT tweet.tweet,
                COUNT(like.like_id) AS likes,
                COUNT(reply.reply_id) AS replies,
                tweet.date_time AS dateTime 
        FROM tweet LEFT JOIN reply ON reply.tweet_id = tweet.tweet_id LEFT JOIN like ON like.tweet_id = tweet.tweet_id
        WHERE tweet.user_id = ${userId}
        GROUP BY
            tweet.tweet_id ; 
    `;

  const turnToTwoDigit = (givenDigit) => {
    if (String(givenDigit).length === 1) {
      return "0" + givenDigit;
    } else {
      return givenDigit;
    }
  };
  const allTweets = await dbConnection.all(getUserTweetsQuery);
  let tempDate;
  let eachDate;
  for (let eachObj of allTweets) {
    tempDate = new Date(eachObj.dateTime);
    eachDate = `${tempDate.getFullYear()}-${
      tempDate.getMonth() + 1
    }-${tempDate.getDate()} ${turnToTwoDigit(
      tempDate.getHours()
    )}:${turnToTwoDigit(tempDate.getMinutes())}:${turnToTwoDigit(
      tempDate.getSeconds()
    )}`;
    eachObj.dateTime = eachDate;
  }
  response.send(allTweets);
});

//POST A TWEET API10
twitterApp.post("/user/tweets/", verifyToken, async (request, response) => {
  const userId = request.userId;
  const { tweet } = request.body;
  const timeNow = new Date();
  const currentTime = `${timeNow.getFullYear()}-${
    timeNow.getMonth() + 1
  }-${timeNow.getDate()} ${timeNow.getHours()}:${timeNow.getMinutes()}:${timeNow.getSeconds()}`;

  const postTweetQuery = `
        INSERT INTO tweet
            (user_id,tweet,date_time)
        VALUES
            (${userId},"${tweet}","${currentTime}");    
    `;

  await dbConnection.run(postTweetQuery);
  response.send("Created a Tweet");
});

//DELETE A TWEET API11
twitterApp.delete(
  "/tweets/:tweetId/",
  verifyToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userId = request.userId;

    const tweetByUserQuery = `
        SELECT tweet_id
        FROM tweet
        WHERE user_id = ${userId};
    `;
    const allTweetsObj = await dbConnection.all(tweetByUserQuery);
    const allTweetsArr = [];
    for (let eachObj of allTweetsObj) {
      allTweetsArr.push(eachObj.tweet_id);
    }

    if (allTweetsArr.includes(parseInt(tweetId))) {
      const deleteTweetQuery = `
            DELETE FROM tweet
            WHERE tweet_id = ${tweetId};
        `;
      await dbConnection.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = twitterApp;

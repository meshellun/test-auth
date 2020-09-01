require("dotenv").config();
const express = require("express");
const app = express();
const path = require("path");
const bodyParser = require('body-parser');
// const cookieParser = require('cookie-parser');
const otplib = require('otplib');
const authenticator = otplib.authenticator;
const SDK = require('@ringcentral/sdk').SDK;
const nodemailer = require("nodemailer");
const jwt = require('jsonwebtoken');
const sanitizeEmail = require('sanitize-mail');
// const csrf = require('csurf');
const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_TOKEN_SECRET;

authenticator.options = {
    step: 120
};

const generateOTPSecret = () => authenticator.generateSecret();
const generateOTPToken = (secret) => {
   return authenticator.generate(secret);
};
const verifyOTP = (token, secret) => authenticator.verify({token, secret});
const generateJWTToken = (authData) => jwt.sign(authData, ACCESS_TOKEN_SECRET, {expiresIn: '60m'});

const testSecret = generateOTPSecret();
//MiddleWare Use Could use this for Authenticated Routes
/*
//eg of calling middleware
    app.post('/routeToAuthenticate', authenticateJWT,(req, res) => {

    })
*/
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const jwtToken = authHeader && authHeader.split(' ')[1];
    if (jwtToken == null) {
        return res.sendState(401);
    }

    jwt.verify(jwtToken, ACCESS_TOKEN_SECRET, (err, authData) => {
        if (err) return res.sendStatus(403);
        req.authData = authData;
        next();
    });
};


const rcsdk = new SDK({
    server: process.env.RING_CENTRAL_QA_SERVER,
    clientId: process.env.RING_CENTRAL_CLIENT_ID,
    clientSecret: process.env.RING_CENTRAL_CLIENT_SECRET
});

const platform = rcsdk.platform();
platform.login({
    username: process.env.RING_CENTRAL_PHONE,
    password: process.env.RING_CENTRAL_SECRET,
    extension: process.env.RING_CENTRAL_EXTENSION
    })
    .then(function(resp) {
        console.log(resp.body);
        console.log('Logged into Ring Central');
    }).catch(err => {
        console.log(err);
        console.log(err.messageStatus);
    });

function send_sms(recipient, token, res){
  platform.post('/restapi/v1.0/account/~/extension/~/sms', {
       from: {'phoneNumber': process.env.RING_CENTRAL_PHONE},
       to: [{'phoneNumber': recipient}],
       text: 'Your TOKEN ' + token
     })
     .then(function (resp) {
        console.log("SMS sent. Message status: " + resp.json().messageStatus);
        res.status(200);
        res.end();
     });
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SENDER_EMAIL,
      pass: process.env.SENDER_SECRET
    }
  });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
// app.use(cookieParser());
// app.use(csrfProtection);

app.post('/login', (req, res) => {

    const phone = req.body.phone;
    const username = sanitizeEmail(req.body.email);
    //Find PayerUser BY Email or Phone => return authData

    /* MDY114 FOR TESTING ONLY */
    let authData; // {
    if (phone === process.env.TEST_PHONE || username === process.env.TEST_EMAIL) {
        authData = {
            payerUserSFId: 'testSFIDUser',
            userOtpSecret : testSecret
        };
    }
    /*                     */

  if (authData == null) {
      return res.status(401);
    }
    
    if (!authData.userOtpSecret){
        authData.userOtpSecret = generateOTPSecret();
    } 

    let tokenOTP = generateOTPToken(authData.userOtpSecret);

    if (phone) {
        return send_sms(phone, tokenOTP, res);
    }

    if (username) {
        const jwtToken = generateJWTToken(authData);
        let authenticatedLink= `localhost:3000/?${jwtToken}`;
        let mailOptions = {
            from: process.env.SENDER_EMAIL,
            to: username,
            subject: 'Midland Payment Portal Login',
            text: `You can access portal using verification code ${tokenOTP}  or by going to this link ${authenticatedLink}`
          };
          
          transporter.sendMail(mailOptions, function(error, info){
            if (error) {
              console.log(error);
            } else {
              console.log('Email sent: ' + info.response);
            }
            res.end();
            });
        return;
    }
});


app.post('/verifyOtp', (req, res) => {
    const otpToken = '' +req.body.otp;
    const phone = req.body.phone;
    const email = req.body.email;
    console.log(phone + ' ' + email);
    // FIND USER BY PHONENUMBER OR EMAIL
    let user;
    let authData;
    console.log(authenticator.timeRemaining());
    console.log(authenticator.timeUsed());

    /*MDY114 FOR TESTING */
    if (phone === process.env.TEST_PHONE || username === process.env.TEST_EMAIL) {
        user = {
            Id: 'testSFId', 
            otpSecret: testSecret
        };    
        authData = {
            payerUserSFId: user.Id,
            userOtpSecret: user.otpSecret
        };
    }
    /*    */

    let isValidOTP = user.otpSecret && verifyOTP(otpToken, user.otpSecret);

    if (!isValidOTP) {
     return res.status(401).send('invalid token');
    }

    if (authData) {
        let jwtToken = generateJWTToken(authData);
        // let refreshJWTToken = jwt.sign()

        // res.cookie('jwt', jwtToken, { httpOnly: true, secure: true });
        return res.status(200).send({	
            token: jwtToken,	
            // refreshToken: refreshJWTToken	
        });
    }
    res.end();

});


app.post('/registerUser', (req, res) => {
    let email = sanitizeMail(req.body.email);
    let phone = req.body.phone;

    // TO DO SAVE PAYER USER and return new user back 
    let payerUser = {
        Id: 'testSFIDUser',
        otpSecret: testSecret
    };

    if (!payerUser) return res.status(401);

    const jwtToken = generateJWTToken(payerUser);
    return res.status(200).send({	
        token: jwtToken
        // refreshToken: refreshJWTToken	
    });
    
});

app.post('/nonLoggedInUser', (req, res) => {
    let assetName = req.body.assetName;
    // TO DO check to see if it is an existing CUSIP 
    let cusip = {
        salesforce_id: 'testCUSIPSFId', 
    } 

    if (!cusip) {
        return res.status(401);
    }

    let jwtToken =generateJWTToken(cusip);
    return res.status(200).send({	
        token: jwtToken,	
        // refreshToken: refreshJWTToken	
    });
});

// app.get('/csrf-token', (req, res) => {
//     res.json({ csrfToken: req.csrfToken() });
// });

app.get("/", (req, res) => {
    res.json("hello world");
});

const port = process.env.PORT || 8000;

app.listen(port, function () {
    console.log(`🌎 ==> Server now on port ${port}!`);
});

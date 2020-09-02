require("dotenv").config();
const express = require("express");
const app = express();
const path = require("path");
const bodyParser = require('body-parser');
const otplib = require('otplib');
const authenticator = otplib.authenticator;
const SDK = require('@ringcentral/sdk').SDK;
const nodemailer = require("nodemailer");
const jwt = require('jsonwebtoken');
const sanitizeEmail = require('sanitize-mail');
const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_TOKEN_SECRET;
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const passport = require('passport');

authenticator.options = {
    step: 120
};

const generateOTPSecret = () => authenticator.generateSecret();
const generateOTPToken = (secret) => {
   return authenticator.generate(secret);
};
const verifyOTP = (token, secret) => authenticator.verify({token, secret});
const generateJWTToken = (authData) => jwt.sign(authData, ACCESS_TOKEN_SECRET, {expiresIn: '60m'});

const sfConnection = new jsforce.Connection({
    oauth2 : {
        loginUrl: process.env.QA_LOGIN_URL,
        clientId: process.env.QA_CLIENT_ID,
        clientSecret: process.env.QA_CLIENT_SECRET
    }
});

sfConnection.login(process.env.QA_USERNAME, process.env.QA_SECRET_PASSWORD, (err, userInfo) => {
    if (err) console.log(err);
    console.log("User ID: " + userInfo.id);
    console.log("Org ID: " + userInfo.organizationId);
});

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
app.use(session({secret: process.env.SESSION_SECRET, resave: true,
    saveUninitialized: true}));
app.use(passport.initialize());
app.use(passport.session());


app.post('/login', (req, res) => {
    const phone = req.body.phone;
    const username = sanitizeEmail(req.body.email);
    let payerUserQuery = 'SELECT Id, OTPSecret__c FROM PayerUser__c WHERE';
    if (phone) {
        payerUserQuery += ` Phone__c = '${phone}'`;
    }
    if (phone && username) {
        payerUserQuery += ' OR';
    }
    if (username) {
        payerUserQuery += ` Username__c= '${username}'`;
    }
    const verifyUserAndSendToken = async () => {
        try {
            let payerUserQueryResult = await sfConnection.query(payerUserQuery);
            if (payerUserQueryResult.records.length === 0 ) return res.status(401).send('User not found in our system');
            let payerUser = payerUserQueryResult.records[0];
            if (!payerUser.OTPSecret__c){
                payerUser.OTPSecret__c = generateOTPSecret();
                await sfConnection.sobject("PayerUser__C").update(payerUser);
            }
            let tokenOTP = generateOTPToken(payerUser.OTPSecret__c);
            if (phone) {
                return send_sms(phone, tokenOTP, res);
            }

            if (username) {
                const jwtToken = generateJWTToken(payerUser);
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

        } catch(err){
            console.log(err);
        }
        res.end();
    };
    verifyUserAndSendToken();
});

//when coming from magic link use useEffect query urlParams ?jwtToken
app.post('/verifyJWT', (req, res) => {
    let jwtToken = req.body.jwtToken;
    if (jwtToken == null) return res.status(401);
     
    jwt.verify(jwtToken, ACCESS_TOKEN_SECRET, (err, userData) => {
        if (err) return res.sendStatus(403);
        let sessionId = uuidv4();
        // TO DO : STORE SESSION ON A DB 
        res.json({sessionId, userId: userData.Id});
    });
});


app.post('/verifyOtp', (req, res) => {
    const otpToken = req.body.otp;
    const phone = req.body.phone;
    const username = sanitizeEmail(req.body.email);
    if (!otpToken && (!phone || !username)) return res.status(401).send('Info Invalid');

    console.log(authenticator.timeRemaining());
    console.log(authenticator.timeUsed());
    const verifyUserAndVerifyToken = async () => {
        try {
            let payerUserQuery = 'SELECT Id, OTPSecret__c FROM PayerUser__c WHERE';
            if (phone) {
                payerUserQuery += ` Phone__c = '${phone}'`;
            }
            if (phone && username) {
                payerUserQuery += ' OR';
            }
            if (username) {
                payerUserQuery += ` Username__c= '${username}'`;
            }
            let payerUserQueryResult = await sfConnection.query(payerUserQuery);
            if (payerUserQueryResult.records.length === 0 ) return res.status(401).send('User not found in our system');
            let payerUser = payerUserQueryResult.records[0];
            
            let isValidOTP = payerUser.OTPSecret__c && verifyOTP(otpToken, payerUser.OTPSecret__c);
            if (!isValidOTP) {
             return res.status(401).send('invalid token');
            }
        
            if (payerUser) {
                let sessionId = uuidv4();
                // TO DO : STORE SESSION ON A DB 
                res.json({sessionId, userId: payerUser.Id});
            }
            res.end();

        } catch (err) {
            console.log(err);
            res.status(401).send('invalid token');
        }
    };
    verifyUserAndVerifyToken();
});


app.post('/registerUser', (req, res) => {
    let email = sanitizeMail(req.body.email);
    let phone = req.body.phone;

    let payerUser = {
        OTPSecret__c: generateOTPSecret(), 
        Phone__c: phone,
        Username__c: email
    };

    const insertPayerUser = async () => {
        try {
            await sfConnection.sobject("PayerUser__c").insert(payerUser);
            const jwtToken = generateJWTToken(payerUser);
            let authenticatedLink= `localhost:3000/?${jwtToken}`;
            let mailOptions = {
                from: process.env.SENDER_EMAIL,
                to: email,
                subject: 'Midland Payment Portal Registration',
                text: `You have been registered! You can access portal using verification code ${tokenOTP}  or by going to this link ${authenticatedLink}`
              };
              
              transporter.sendMail(mailOptions, function(error, info){
                if (error) {
                  console.log(error);
                } else {
                  console.log('Email sent: ' + info.response);
                }
                res.end();
            });
        } catch (err) {
            console.log(err);
        }
    }

    if (!payerUser) return res.status(401);
    insertPayerUser();

});

app.post('/guestUser', (req, res) => {
    let assetName = req.body.assetName;
    // TO DO check to see if it is an existing CUSIP
    let cusip = {
        salesforce_id: 'testCUSIPSFId', 
    };

    if (!cusip) {
        return res.status(401);
    }
    let sessionId = uuidv4();
    return res.status(200).send({	
        sessionId, cusipId: cusip.salesforce_id
    });
});




app.get("/", (req, res) => {
    res.json("hello world");
});

const port = process.env.PORT || 8000;

app.listen(port, function () {
    console.log(`🌎 ==> Server now on port ${port}!`);
});

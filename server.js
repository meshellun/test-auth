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
const jsforce = require('jsforce');
//used for csrf protection
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

app.use(express.static(path.join(__dirname,"client", "build")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
// app.use(cookieParser());
// app.use(csrfProtection);

app.post('/login', (req, res) => {

    const phone = req.body.phone;
    const username = sanitizeEmail(req.body.email);
    if (!phone && !username) {
        res.status(500).send('Phone and Username not entered');
    }

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


app.post('/verifyOtp', (req, res) => {
    const otpToken = req.body.otp;
    const phone = req.body.phone;
    const username = sanitizeEmail(req.body.email);

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
                let jwtToken = generateJWTToken(payerUser);
                // let refreshJWTToken = jwt.sign()
        
                // res.cookie('jwt', jwtToken, { httpOnly: true, secure: true });
                return res.status(200).send({	
                    token: jwtToken,	
                    // refreshToken: refreshJWTToken	
                });
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
    let email = sanitizeEmail(req.body.email);
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

app.post('/guestUser', (req, res) => {
    let assetName = req.body.assetName;
    // TO DO check to see if it is an existing CUSIP 
    let cusip = {
        salesforce_id: 'testCUSIPSFId', 
    };

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

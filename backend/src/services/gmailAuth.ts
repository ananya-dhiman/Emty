import dotenv from 'dotenv';
import { google } from 'googleapis';        


  interface Tokens {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
    expiry_date?: number;
  }

  const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
     const oauth2Client = new google.auth.OAuth2(
    process.env.YOUR_CLIENT_ID,
    process.env.YOUR_CLIENT_SECRET,
    process.env.YOUR_REDIRECT_URL
    );
  //Generates google_auth_url to request user consent
async function generateOAuthUrl() {
 
    const scopes = process.env.GOOGLE_GMAIL_SCOPE;
   
    const authorizationUrl= oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        include_granted_scopes: true,
    });
    return authorizationUrl;

   
}


async function exchangeCodeForTokens(code:string):Promise<Tokens>{

    try{
        const credentials = await oauth2Client.getToken(code);
        return credentials.tokens;

    }catch(error){
        throw new Error('Error exchanging code for tokens: ' + error);
    }
  
   
}

async function refreshAccessToken(refreshToken:string):Promise<Tokens>{
    
}

async function revokeToken(token: string): Promise<void>{

}
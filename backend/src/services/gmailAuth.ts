import { GmailAccountModel } from "../model/GmailAccount";


  interface Tokens {
  "access_token"?: string,
  "refresh_token"?: string,
  "expires_in"?: number,
  "scope"?: string,
  "token_type"?: string
}


const isTokenExpired = (expiry?: number) => {
  if (!expiry) return true;
  return Date.now() >= expiry - 60_000; 
};


  const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
   
  //Generates google_auth_url to request user consent
export async function generateOAuthUrl(oauth2Client:any,state:string):Promise<string>{ 
   
   
 
    const scopes = process.env.GOOGLE_GMAIL_SCOPE;
   
    const authorizationUrl= oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        include_granted_scopes: true,
        state: state
    });
    return authorizationUrl;

   
}


export async function exchangeCodeForTokens(code:string,oauth2Client:any):Promise<Tokens>{

    try{
        const credentials = await oauth2Client.getToken(code);
        if(credentials===undefined){
            throw new Error('No credentials returned from token exchange');
        }
        //Handle referesh token logic when db managing
        return credentials.tokens;

    }catch(error){
        throw new Error('Error exchanging code for tokens: ' + error);
    }
  
   
}

export async function refreshAccessToken(emailAddress:String,oauth2Client:any):Promise<any>{
    try{
        const dets=await GmailAccountModel.findOne({emailAddress:emailAddress});
        if(!dets){
            throw new Error('No Gmail account found for the provided email address');
        }
        
        if(isTokenExpired(dets.tokenExpiry.getTime())){
              const { credentials } = await oauth2Client.refreshAccessToken();

                // 4. Persist new token
                dets.accessToken = credentials.access_token!;
                dets.tokenExpiry = credentials.expiry_date!;
                await dets.save();

                // 5. Return ready client
                oauth2Client.setCredentials(credentials);
                


            
        }
        //return with or without refresh
        return oauth2Client;


    }catch(error){
        throw new Error('Error refreshing access token: ' + error);
    }

  
    
}

export async function revokeToken(token: string): Promise<void>{

}
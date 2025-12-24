

  interface Tokens {
  "access_token"?: string,
  "refresh_token"?: string,
  "expires_in"?: number,
  "scope"?: string,
  "token_type"?: string
}




  const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
   
  //Generates google_auth_url to request user consent
export async function generateOAuthUrl(oauth2Client:any):Promise<string>{ 
   
   
 
    const scopes = process.env.GOOGLE_GMAIL_SCOPE;
   
    const authorizationUrl= oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        include_granted_scopes: true,
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

export async function refreshAccessToken(refreshToken:string):Promise<Tokens>{
  
    
}

export async function revokeToken(token: string): Promise<void>{

}
import { google } from 'googleapis';      

export function createOAuthClient() {
  return new google.auth.OAuth2(
     process.env.YOUR_CLIENT_ID,
    process.env.YOUR_CLIENT_SECRET,
    process.env.YOUR_REDIRECT_URL
  );
}

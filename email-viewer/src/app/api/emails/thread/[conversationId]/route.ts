import { NextResponse } from 'next/server';

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface GraphEmail {
  id: string;
  conversationId: string;
  subject: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  receivedDateTime: string;
  bodyPreview: string;
  hasAttachments: boolean;
}

interface GraphApiResponse {
  value: GraphEmail[];
}

// Always fetch a fresh token - don't cache due to issues with Next.js hot reloading
async function getAccessToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.MS_CLIENT_ID || '',
    client_secret: process.env.MS_CLIENT_SECRET || '',
    scope: 'https://graph.microsoft.com/.default',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to get access token:', errorText);
    throw new Error('Failed to get access token');
  }

  const data: TokenResponse = await response.json();
  console.log('Access token obtained, expires in', data.expires_in, 'seconds');

  return data.access_token;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId: rawConversationId } = await params;

  if (!rawConversationId) {
    return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
  }

  // Decode the conversation ID in case it was double-encoded
  const conversationId = decodeURIComponent(rawConversationId);

  try {
    const token = await getAccessToken();

    // Fetch all emails with this conversation ID from MS Graph
    const graphUrl = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages`;

    // Escape single quotes in the conversation ID for OData filter
    const escapedConversationId = conversationId.replace(/'/g, "''");
    const filterQuery = `conversationId eq '${escapedConversationId}'`;

    // Note: Can't use $orderby with $filter on conversationId due to MS Graph limitations
    // We'll sort the results after fetching
    const requestUrl = `${graphUrl}?$filter=${encodeURIComponent(filterQuery)}&$select=id,conversationId,subject,from,receivedDateTime,bodyPreview,hasAttachments&$top=50`;

    console.log('Fetching thread with conversation ID:', conversationId);

    const graphResponse = await fetch(
      requestUrl,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!graphResponse.ok) {
      const errorText = await graphResponse.text();

      // Check if token expired and retry with fresh token
      if (graphResponse.status === 401 && errorText.includes('InvalidAuthenticationToken')) {
        console.log('Token expired, refreshing and retrying...');
        const freshToken = await getAccessToken();

        const retryResponse = await fetch(
          requestUrl,
          {
            headers: {
              Authorization: `Bearer ${freshToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (retryResponse.ok) {
          const retryData: GraphApiResponse = await retryResponse.json();
          const emails = retryData.value
            .map((email) => ({
              id: email.id,
              conversationId: email.conversationId,
              subject: email.subject || '(No Subject)',
              senderName: email.from?.emailAddress?.name || 'Unknown',
              senderEmail: email.from?.emailAddress?.address || '',
              receivedDateTime: email.receivedDateTime,
              bodyPreview: email.bodyPreview || '',
              hasAttachments: email.hasAttachments || false,
            }))
            .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime());

          return NextResponse.json({
            conversationId,
            emails,
            count: emails.length,
          });
        }
      }

      console.error('MS Graph API error:', errorText);
      console.error('Conversation ID used:', conversationId);
      console.error('Request URL:', requestUrl);
      return NextResponse.json({ error: 'Failed to fetch from MS Graph' }, { status: 500 });
    }

    const graphData: GraphApiResponse = await graphResponse.json();

    // Transform to match our ThreadEmail format and sort by date descending (newest first)
    const emails = graphData.value
      .map((email) => ({
        id: email.id,
        conversationId: email.conversationId,
        subject: email.subject || '(No Subject)',
        senderName: email.from?.emailAddress?.name || 'Unknown',
        senderEmail: email.from?.emailAddress?.address || '',
        receivedDateTime: email.receivedDateTime,
        bodyPreview: email.bodyPreview || '',
        hasAttachments: email.hasAttachments || false,
      }))
      .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime());

    return NextResponse.json({
      conversationId,
      emails,
      count: emails.length,
    });
  } catch (error) {
    console.error('Error fetching email thread:', error);
    return NextResponse.json({ error: 'Failed to fetch email thread' }, { status: 500 });
  }
}

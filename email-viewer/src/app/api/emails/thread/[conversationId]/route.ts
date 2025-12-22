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

// Cache token in memory
let accessToken: string | null = null;
let tokenExpiry: number | null = null;

async function getAccessToken(): Promise<string> {
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

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
  });

  if (!response.ok) {
    throw new Error('Failed to get access token');
  }

  const data: TokenResponse = await response.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

  return accessToken;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;

  if (!conversationId) {
    return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
  }

  try {
    const token = await getAccessToken();

    // Fetch all emails with this conversation ID from MS Graph
    // Note: MS Graph uses lowercase 'conversationid' in filter queries
    const graphUrl = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages`;
    const filterQuery = `conversationid eq '${conversationId}'`;

    const graphResponse = await fetch(
      `${graphUrl}?$filter=${encodeURIComponent(filterQuery)}&$select=id,conversationId,subject,from,receivedDateTime,bodyPreview,hasAttachments&$top=50`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!graphResponse.ok) {
      const errorText = await graphResponse.text();
      console.error('MS Graph API error:', errorText);
      return NextResponse.json({ error: 'Failed to fetch from MS Graph' }, { status: 500 });
    }

    const graphData: GraphApiResponse = await graphResponse.json();

    // Transform to match our ThreadEmail format and sort by date
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
      .sort((a, b) => new Date(a.receivedDateTime).getTime() - new Date(b.receivedDateTime).getTime());

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

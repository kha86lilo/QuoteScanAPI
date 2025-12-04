import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// Microsoft Graph API helper
async function getAccessToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    client_secret: process.env.MS_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to get access token');
  }

  const data = await response.json();
  return data.access_token;
}

async function fetchAttachments(messageId: string): Promise<any[]> {
  const token = await getAccessToken();

  const url = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages/${messageId}/attachments`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    console.error('Failed to fetch attachments:', await response.text());
    return [];
  }

  const data = await response.json();
  return data.value || [];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ emailId: string }> }
) {
  const { emailId: emailIdParam } = await params;
  const emailId = parseInt(emailIdParam);

  if (isNaN(emailId)) {
    return NextResponse.json({ error: 'Invalid email ID' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    // Get the email_message_id from our database
    const emailResult = await client.query(
      `SELECT email_message_id, email_has_attachments FROM shipping_emails WHERE email_id = $1`,
      [emailId]
    );

    if (emailResult.rows.length === 0) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    const { email_message_id, email_has_attachments } = emailResult.rows[0];

    if (!email_has_attachments) {
      return NextResponse.json({ attachments: [] });
    }

    // Fetch attachments from Microsoft Graph API
    const attachments = await fetchAttachments(email_message_id);

    // Return sanitized attachment info (without the actual content for the list)
    const sanitizedAttachments = attachments.map((att: any) => ({
      id: att.id,
      name: att.name,
      contentType: att.contentType,
      size: att.size,
      isInline: att.isInline || false,
      lastModifiedDateTime: att.lastModifiedDateTime,
    }));

    return NextResponse.json({ attachments: sanitizedAttachments });
  } catch (error) {
    console.error('Error fetching attachments:', error);
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 });
  } finally {
    client.release();
  }
}

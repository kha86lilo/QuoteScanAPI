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

async function fetchAttachmentContent(messageId: string, attachmentId: string): Promise<any> {
  const token = await getAccessToken();

  const url = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages/${messageId}/attachments/${attachmentId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    console.error('Failed to fetch attachment:', await response.text());
    throw new Error('Failed to fetch attachment');
  }

  return response.json();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ emailId: string; attachmentId: string }> }
) {
  const { emailId: emailIdParam, attachmentId } = await params;
  const emailId = parseInt(emailIdParam);

  if (isNaN(emailId)) {
    return NextResponse.json({ error: 'Invalid email ID' }, { status: 400 });
  }

  if (!attachmentId) {
    return NextResponse.json({ error: 'Invalid attachment ID' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    // Get the email_message_id from our database
    const emailResult = await client.query(
      `SELECT email_message_id FROM shipping_emails WHERE email_id = $1`,
      [emailId]
    );

    if (emailResult.rows.length === 0) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    const { email_message_id } = emailResult.rows[0];

    // Fetch the attachment content from Microsoft Graph API
    const attachment = await fetchAttachmentContent(email_message_id, attachmentId);

    if (!attachment.contentBytes) {
      return NextResponse.json({ error: 'Attachment content not available' }, { status: 404 });
    }

    // Decode base64 content
    const contentBuffer = Buffer.from(attachment.contentBytes, 'base64');

    // Return the file with proper headers
    return new NextResponse(contentBuffer, {
      status: 200,
      headers: {
        'Content-Type': attachment.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.name)}"`,
        'Content-Length': contentBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Error fetching attachment:', error);
    return NextResponse.json({ error: 'Failed to fetch attachment' }, { status: 500 });
  } finally {
    client.release();
  }
}

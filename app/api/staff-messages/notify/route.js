import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { notifyAdminAndCohost, notifyStaff } from '@/lib/staff-notifications';
import { nt, getStaffLocale } from '@/lib/notification-strings';

export async function POST(request) {
  const { caller, error } = await requireAuth(request);
  if (error) return error;

  const { staffId, staffName, sender, text } = await request.json();

  if (sender === 'staff') {
    // Cleaner sent a message → notify admin/cohost
    const name = staffName || 'Staff';
    await notifyAdminAndCohost({
      title: 'Staff Message',
      body: `${name}: ${(text || '').slice(0, 100) || 'New message'}`,
      type: 'staff_message',
      data: {
        targetPath: '/admin/staff-messages',
        sourceAction: 'staff_message',
        sourceId: staffId,
      },
      localizer: (locale) => ({
        title: nt(locale, 'staffMessage_title'),
        body: `${name}: ${(text || '').slice(0, 100) || nt(locale, 'staffMessage_fallback')}`,
      }),
    });
  } else if (sender === 'host' && staffId) {
    // Admin replied → notify the specific staff member
    const staffLocale = await getStaffLocale(staffId);
    await notifyStaff({
      staffIds: [staffId],
      title: nt(staffLocale, 'staffMessageFromHost_title'),
      body: nt(staffLocale, 'staffMessageFromHost_body'),
      type: 'staff_message',
      data: {
        targetPath: '/admin/cleaning',
        sourceAction: 'staff_message_reply',
      },
    });
  }

  return NextResponse.json({ success: true });
}

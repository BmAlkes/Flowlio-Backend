import { eq } from 'drizzle-orm';
import { database } from '@/configs/connection.config';
import { calendarEvents } from '@/schema/schema';
import { googleCalendarService } from '@/services/googleCalendar.service';
import { logger } from '@/utils/logger.util';

// Same as creating an event on the Calendar page: when the person has Google Calendar connected,
// push each new event to their primary calendar and remember the link. Failures are logged only.
export async function syncEventsToGoogle(userId:string,eventIds:string[]){
 if(!(await googleCalendarService.setCredentials(userId)))return;
 for(const id of eventIds){
  try{
   const [event]=await database.select().from(calendarEvents).where(eq(calendarEvents.id,id)).limit(1);
   if(!event||event.userId!==userId)continue;
   const google=await googleCalendarService.syncAppEventToGoogle(userId,event,'primary');
   if(google)await database.update(calendarEvents).set({googleEventId:google.id,googleCalendarId:'primary',syncStatus:'synced',lastSyncAt:new Date(),
    googleEventData:{htmlLink:google.htmlLink||undefined,hangoutLink:google.hangoutLink||undefined,location:google.location||undefined,recurrence:google.recurrence||undefined}}).where(eq(calendarEvents.id,id));
  }catch(error){logger.error('Failed to sync an agent calendar event to Google Calendar',{eventId:id,userId,errorMessage:error instanceof Error?error.message:'Unknown error'});}
 }
}

import { eq } from 'drizzle-orm';
import { database } from '@/configs/connection.config';
import { calendarEvents } from '@/schema/schema';
import { googleCalendarService } from '@/services/googleCalendar.service';
import { sendTransactionalEmail } from '@/services/email/transactional.service';
import { logger } from '@/utils/logger.util';
import type { Effects } from './actions';

const message=(error:unknown)=>error instanceof Error?error.message:'Unknown error';

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
  }catch(error){logger.error('Failed to sync an agent calendar event to Google Calendar',{eventId:id,userId,errorMessage:message(error)});}
 }
}

// Same as editing an event on the Calendar page: move the linked Google event, or send it if it was never synced.
export async function updateEventsInGoogle(userId:string,eventIds:string[]){
 if(!(await googleCalendarService.setCredentials(userId)))return;
 for(const id of eventIds){
  try{
   const [event]=await database.select().from(calendarEvents).where(eq(calendarEvents.id,id)).limit(1);
   if(!event||event.userId!==userId)continue;
   if(!event.googleEventId){await syncEventsToGoogle(userId,[id]);continue;}
   await googleCalendarService.updateEvent(userId,event.googleCalendarId||'primary',event.googleEventId,await googleCalendarService.toGoogleEvent(userId,event));
   await database.update(calendarEvents).set({syncStatus:'synced',lastSyncAt:new Date()}).where(eq(calendarEvents.id,id));
  }catch(error){logger.error('Failed to move an agent calendar event in Google Calendar',{eventId:id,userId,errorMessage:message(error)});}
 }
}

// Same as deleting an event on the Calendar page: the Flowlio event is already gone, remove its Google copy.
export async function deleteEventsFromGoogle(userId:string,events:Effects['deletedEvents']){
 if(!(await googleCalendarService.setCredentials(userId)))return;
 for(const event of events){
  try{await googleCalendarService.deleteEvent(userId,event.googleCalendarId,event.googleEventId);}
  catch(error){logger.error('Failed to delete an agent calendar event from Google Calendar',{googleEventId:event.googleEventId,userId,errorMessage:message(error)});}
 }
}

// Same channel as the Messages tab: the message is already recorded on the client, this emails it to them.
export async function emailClients(messages:Effects['messages']){
 for(const m of messages){
  const result=await sendTransactionalEmail({to:m.to,toName:m.name,templateKey:'client_message',data:{subject:m.subject,message:m.message,from:m.from,clientName:m.name}});
  if(!result.success)logger.error('Failed to email an agent client message',{error:result.error});
 }
}

export const agentHooks={eventsCreated:syncEventsToGoogle,eventsUpdated:updateEventsInGoogle,eventsDeleted:deleteEventsFromGoogle,clientMessages:emailClients};

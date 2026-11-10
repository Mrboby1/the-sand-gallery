// Every feature of the app with a one-line "how to", shown in Settings > Features & tips and searchable
// from the Settings search. When you add a feature, add it here (and its two strings in i18n/en.ts).
import type { MsgKey } from '../i18n'

export interface Feature { id: string; keywords: string }
export interface FeatureGroup { id: string; features: Feature[] }

export const FEATURE_GROUPS: FeatureGroup[] = [
  { id: 'projects', features: [
    { id: 'create', keywords: 'new project add plus button create' },
    { id: 'subtasks', keywords: 'subtask nested inside child' },
    { id: 'templates', keywords: 'template save as template new from template' },
    { id: 'folders', keywords: 'folder folders group organise organize gallery new folder move' },
    { id: 'camera', keywords: 'camera take photo picture snap phone capture save gallery downloads' },
    { id: 'download', keywords: 'download save original photo video file' },
    { id: 'longpress', keywords: 'long press menu right click rename move duplicate delete undo actions' },
    { id: 'status', keywords: 'status pill bar idea progress done sold board' },
    { id: 'finishedTab', keywords: 'filter finished unfinished all done tag tags separate archive reopen mark finished' },
    { id: 'finished', keywords: 'finished done sold gallery mode album manage' },
    { id: 'clientview', keywords: 'client view hide costs prices eye' },
  ] },
  { id: 'time', features: [
    { id: 'timer', keywords: 'timer start pause stopwatch total subtasks running one at a time' },
    { id: 'fullscreen', keywords: 'fullscreen hourglass grains of sand count' },
    { id: 'sandfill', keywords: 'sand fill empty new project pile grows' },
    { id: 'freeze', keywords: 'paused frozen freeze ice blue frost' },
    { id: 'timelog', keywords: 'time log edit session add manual weekly total' },
    { id: 'period', keywords: 'today this week this month all time worked summary total period day' },
    { id: 'notifications', keywords: 'notification running timer stop open phone' },
    { id: 'reminders', keywords: 'reminder still working remind every custom interval' },
    { id: 'week', keywords: 'week starts sunday monday other weekly total calendar' },
  ] },
  { id: 'photos', features: [
    { id: 'upload', keywords: 'upload photo video camera gallery add' },
    { id: 'cover', keywords: 'cover photo set as cover process finished' },
    { id: 'photonotes', keywords: 'photo note caption bubble video note' },
    { id: 'notes', keywords: 'notes several pin edit delete add note' },
  ] },
  { id: 'views', features: [
    { id: 'views', keywords: 'grid list board calendar view switch drag' },
    { id: 'tags', keywords: 'tags filter hashtag' },
    { id: 'search', keywords: 'search find notes tags status' },
    { id: 'due', keywords: 'due date deadline calendar' },
  ] },
  { id: 'sharing', features: [
    { id: 'share', keywords: 'share link public read only revoke' },
    { id: 'costs', keywords: 'costs materials hourly rate markup suggested price' },
  ] },
  { id: 'look', features: [
    { id: 'theme', keywords: 'dark mode light theme' },
    { id: 'styles', keywords: 'style flat glossy 2d hourglass' },
    { id: 'colours', keywords: 'colour color slider hue brightness light dark background sand freeze' },
    { id: 'customise', keywords: 'customise customize full screen palette preview colours style theme' },
  ] },
  { id: 'app', features: [
    { id: 'install', keywords: 'install phone home screen app' },
    { id: 'offline', keywords: 'offline no signal sync later queue' },
    { id: 'updates', keywords: 'update new version' },
    { id: 'wake', keywords: 'asleep wake up database' },
    { id: 'backups', keywords: 'backup nightly back up now data' },
    { id: 'offlineVersion', keywords: 'offline version no account device install download local private' },
    { id: 'export', keywords: 'export everything file download backup computer sandgallery' },
    { id: 'import', keywords: 'import restore file open offline online' },
    { id: 'private', keywords: 'private allowed people invite whitelist allow list sign in access' },
  ] },
]

export const featureTitle = (id: string) => `feature.${id}.title` as MsgKey
export const featureHow = (id: string) => `feature.${id}.how` as MsgKey
export const groupTitle = (id: string) => `featureGroup.${id}` as MsgKey

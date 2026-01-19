export type JobStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
export type LocationType = 'remote' | 'hybrid' | 'onsite';
export type JobType = 'full-time' | 'part-time' | 'contract' | 'internship';

export interface Salary {
  min: number;
  max: number;
  currency: string;
}

export type ExperienceLevel = 'internship' | 'entry' | 'associate' | 'mid-senior' | 'director' | 'executive';

export interface Job {
  id: string;
  sourceJobId: string; // Job ID from the source platform (LinkedIn, Indeed, etc.)
  title: string;
  company: string;
  companyLogo?: string;
  location: string;
  locationType: LocationType;
  salary?: Salary;
  salaryText?: string; // Raw salary text (e.g., "$120K - $150K/yr")
  jobType: JobType;
  experienceLevel?: ExperienceLevel;
  postedAt: string;
  postedTime?: string; // Raw time text (e.g., "2 days ago")
  capturedAt: string;
  url: string;
  description?: string;
  status: JobStatus;
  applicationId?: string;
}

export interface JobFilters {
  status?: JobStatus;
  locationType?: LocationType;
  jobType?: JobType;
  search?: string;
}


export type JobStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
export type LocationType = 'remote' | 'hybrid' | 'onsite';
export type JobType = 'full-time' | 'part-time' | 'contract' | 'internship';

export interface Salary {
  min: number;
  max: number;
  currency: string;
}

export interface Job {
  id: string;
  linkedinJobId: string;
  title: string;
  company: string;
  companyLogo?: string;
  location: string;
  locationType: LocationType;
  salary?: Salary;
  jobType: JobType;
  postedAt: string;
  capturedAt: string;
  url: string;
  description?: string;
  status: JobStatus;
  easyApply: boolean;
  applicationId?: string;
}

export interface JobFilters {
  status?: JobStatus;
  locationType?: LocationType;
  jobType?: JobType;
  search?: string;
}


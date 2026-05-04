import React from 'react';
import { AnalyticsDashboard } from './AnalyticsDashboard';

export const ClientsPage: React.FC<Omit<React.ComponentProps<typeof AnalyticsDashboard>, 'initialTab'>> = (props) => (
  <AnalyticsDashboard {...props} initialTab="clients" />
);

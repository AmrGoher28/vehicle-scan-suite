

# FleetScan — Vehicle Damage Inspection App

## Overview
A professional dark-themed web app for car rental companies to manage vehicles and track damage inspections.

## Pages & Features

### 1. Login Page
- Email/password authentication via Supabase (Lovable Cloud)
- Dark themed login form with blue accent button
- Redirect to dashboard on success

### 2. Dashboard
- Header with "FleetScan" branding and logout button
- "Add Vehicle" button (top right)
- Card grid of vehicles, each showing: thumbnail image, make/model, plate number, last inspection date
- Click a card → navigate to vehicle detail page

### 3. Add Vehicle Form (Dialog/Modal)
- Fields: make, model, colour, plate number, photo upload
- Save to Supabase `vehicles` table
- Photo uploaded to Supabase Storage bucket

### 4. Vehicle Detail Page
- Vehicle info section (photo, make, model, colour, plate)
- List of past inspections (date, notes, status) from an `inspections` table
- "Add Inspection" button with a simple form (date, notes, status)

## Database Schema
- **vehicles** table: id, user_id, make, model, colour, plate_number, photo_url, created_at
- **inspections** table: id, vehicle_id, inspection_date, notes, status, created_at
- RLS policies so authenticated users can CRUD their own data
- Storage bucket `vehicle-photos` (public) for vehicle images

## Design
- Dark background with subtle card surfaces
- Blue accent color for buttons, links, and highlights
- Clean typography, rounded cards, consistent spacing


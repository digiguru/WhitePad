# Stage 1: Build React frontend
FROM node:20-alpine AS frontend
WORKDIR /src/WhitePad.Web
COPY src/WhitePad.Web/package*.json ./
RUN npm ci
COPY src/WhitePad.Web/ ./
# Pre-create the parent so vite can write to ../WhitePad.Server/wwwroot
RUN mkdir -p /src/WhitePad.Server
RUN npm run build:server

# Stage 2: Build .NET backend
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY src/WhitePad.Server/ ./WhitePad.Server/
COPY --from=frontend /src/WhitePad.Server/wwwroot ./WhitePad.Server/wwwroot/
WORKDIR /src/WhitePad.Server
RUN dotnet publish WhitePad.Server.csproj -c Release -o /publish

# Stage 3: Runtime image
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /publish .
ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "WhitePad.Server.dll"]

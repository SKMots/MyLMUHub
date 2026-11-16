# My LMU Hub team server. Build: docker compose build (from this folder). The image that runs has no shell and no package manager ("chiseled") and
# runs as a normal user (app, uid 1654), not root.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY MyLMUHub.Server/MyLMUHub.Server.csproj MyLMUHub.Server/
RUN dotnet restore MyLMUHub.Server/MyLMUHub.Server.csproj -r linux-x64
COPY MyLMUHub.Server/ MyLMUHub.Server/
RUN dotnet publish MyLMUHub.Server/MyLMUHub.Server.csproj -c Release -r linux-x64 --self-contained false --no-restore -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_URLS=http://+:8080 MLH_DATA=/data DOTNET_gcServer=0
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "MyLMUHub.Server.dll"]

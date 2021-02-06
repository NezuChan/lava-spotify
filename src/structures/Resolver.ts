import Node from "./Node";
import request from "node-superfetch";
import { LavalinkTrack, LavalinkTrackResponse, SpotifyAlbum, SpotifyPlaylist, SpotifyTrack } from "../typings";
import Util from "../Util";

export default class Resolver {
    public client = this.node.client;
    public cache = new Map<string, LavalinkTrack>();

    public constructor(public node: Node) {}

    public get token(): string {
        return this.client.token!;
    }

    public get playlistPageLoadLimit(): number {
        return this.client.options.playlistPageLoadLimit === 0
            ? Infinity
            : this.client.options.playlistPageLoadLimit!;
    }

    public async getAlbum(id: string): Promise<LavalinkTrackResponse> {
        const album = await Util.tryPromise(async () => {
            return (await request
                .get(`${this.client.baseURL}/albums/${id}`)
                .set("Authorization", this.token)).body as SpotifyAlbum;
        });

        return {
            playlistName: album?.name,
            type: album ? "PLAYLIST_LOADED" : "NO_MATCHES",
            tracks: album
                ? (await Promise.all(album.tracks.items.map(x => this.resolve(x)))).filter(Boolean) as LavalinkTrack[]
                : []
        };
    }

    public async getPlaylist(id: string): Promise<LavalinkTrackResponse> {
        const playlist = await Util.tryPromise(async () => {
            return (await request
                .get(`${this.client.baseURL}/playlists/${id}`)
                .set("Authorization", this.token)).body as SpotifyPlaylist;
        });

        const playlistTracks = playlist ? await this.getPlaylistTracks(playlist) : [];

        return {
            playlistName: playlist?.name,
            type: playlist ? "PLAYLIST_LOADED" : "NO_MATCHES",
            tracks: (await Promise.all(playlistTracks.map(x => this.resolve(x.track)))).filter(Boolean) as LavalinkTrack[]
        };
    }

    public async getTrack(id: string): Promise<LavalinkTrackResponse> {
        const track = await Util.tryPromise(async () => {
            return (await request
                .get(`${this.client.baseURL}/tracks/${id}`)
                .set("Authorization", this.token)).body as SpotifyTrack;
        });

        const lavaTrack = track && await this.resolve(track);

        return {
            type: lavaTrack ? "TRACK_LOADED" : "NO_MATCHES",
            playlistName: '',
            tracks: lavaTrack ? [lavaTrack] : []
        };
    }

    private async getPlaylistTracks(playlist: {
        tracks: {
            items: Array<{ track: SpotifyTrack }>;
            next: string | null;
        };
    }, currPage = 1): Promise<Array<{ track: SpotifyTrack }>> {
        if (!playlist.tracks.next || currPage >= this.playlistPageLoadLimit) return playlist.tracks.items;
        currPage++;

        const { body }: any = await request
            .get(playlist.tracks.next)
            .set("Authorization", this.token);

        const { items, next }: { items: Array<{ track: SpotifyTrack }>; next: string | null } = body;

        const mergedPlaylistTracks = playlist.tracks.items.concat(items);

        if (next && currPage < this.playlistPageLoadLimit) return this.getPlaylistTracks({
            tracks: {
                items: mergedPlaylistTracks,
                next
            }
        }, currPage);
        else return mergedPlaylistTracks;
    }

    private async resolve(track: SpotifyTrack, ytMusic = this.client.options.alwaysUseYTMusic!): Promise<LavalinkTrack | undefined> {
        const cached = this.cache.get(track.id);
        if (cached) return Util.structuredClone(cached);

        try {
            const params = new URLSearchParams({
                identifier: `yt${ytMusic ? "m": ""}search:${track.artists[0].name} - ${track.name}${this.client.options.filterAudioOnlyResult && !ytMusic ? " description:(\"Auto-generated by YouTube.\")" : ""}`
            }).toString();

            // @ts-expect-error 2322
            const { body }: { body: LavalinkTrackResponse } = await request
                .get(`http://${this.node.options.host}:${this.node.options.port}/loadtracks?${params}`)
                .set("Authorization", this.node.options.auth);

            if (body.tracks.length) {
                this.cache.set(track.id, Object.freeze(body.tracks[0]));
                return Util.structuredClone(body.tracks[0]);
            } else if (!ytMusic) {
                return this.resolve(track, true);
            } else {
                return undefined;
            }
        } catch {
            return undefined;
        }
    }
}

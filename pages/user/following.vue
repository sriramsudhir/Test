<template>
  <account-layout
    active-route="following"
    @clicked-compared="loadData"
    class="flow-hidden"
  >
    <template v-slot:rightArea>

      <transition name="fade" mode="out-in">
        <div
          class="spinner-wrapper flex"
          v-if="fetchingAjaxData"
        >
          <spinner
            :radius="100"
          />
        </div>
      </transition>

      <div
        v-if="currentList && !currentList.length"
        class="info-msg"
      >
        {{ $t('store.noData') }}
      </div>

      <div
        v-else
        class="area"
      >
        <div class="area-content user-following">
          <div class="tile-container">

              <store-tile
                v-for="(value, index) in currentList"
                :key="`store-tile-${index}`"
                :store="value.store"
                @removed="removedSuccessfully"
              >
                <template v-slot:followBtn>
                  <follow-btn
                    color="primary"
                    class="visit-btn"
                    :following="true"
                    :store-id="value.store.id"
                    @change-following="removedSuccessfully"
                  />
                </template>
              </store-tile>
          </div>
        </div>
      </div>

      <pagination
        class="mt-20 mt-sm-15"
        ref="followingPagination"
        :total-page="totalPage"
        @fetching-data="fetchingData"
      />

    </template>
  </account-layout>
</template>

<script>

  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import LazyImage from '~/components/LazyImage'
  import RatePopup from '~/components/RatePopup'
  import AccountLayout from '~/components/AccountLayout'
  import ComparedTile from '~/components/ComparedTile'
  import routeParamHelper from '~/mixin/routeParamHelper'
  import Pagination from '~/components/Pagination'
  import Spinner from "~/components/Spinner";
  import TileShimmer from "~/components/TileShimmer";
  import StoreTile from "~/components/StoreTile";
  import FollowBtn from "~/components/FollowBtn";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware', 'auth'],
    head() {
      return {
        title: 'Compared',
        meta: []
      }
    },
    data() {
      return {
        fetchingAjaxData: false,
        result: null,
      }
    },
    watch: {
    },
    components: {
      FollowBtn,
      StoreTile,
      TileShimmer,
      Spinner,
      LazyImage,
      RatePopup,
      AccountLayout,
      Pagination,
      ComparedTile
    },
    mixins: [util, routeParamHelper, global],
    computed: {
      totalPage() {
        return this.result?.last_page
      },
      currentList() {
        return this.result?.data
      },
    },
    methods: {
      async removedSuccessfully(){
        await this.fetchingData()
      },
      async loadData() {
        this.$refs.followingPagination.routeParam()
      },
      async fetchingData() {
        this.fetchingAjaxData = true
        setTimeout(async () => {

          try {
            this.settingRouteParam()

            const data = await this.getRequest({
              params: {
                time_zone: this.timeZone,
                order_by: this.orderBy,
                type: this.orderByType,
                page: this.page,
                q: this.search
              },
              api: 'followingListAll',
              requiredToken: true
            })

            if (data?.status !== 200) {
              this.hasError(data)
            } else if(data?.status === 200){
              this.result = data.data
            }
          } catch (e) {
            return this.$nuxt.error(e)
          }
          this.fetchingAjaxData = false
        }, 100)

      },
      ...mapActions('common', ['getRequest']),
    },
    async mounted() {
      await this.fetchingData()
    },
  }
</script>

<style>

</style>

<template>
  <div>
    <transition name="fade" mode="out-in">
      <div
        class="spinner-wrapper flex"
        v-if="fetchingAddressData"
      >
        <spinner
          :radius="100"
        />
      </div>

      <!--<div
        v-else-if="currentAddresses && !currentAddresses.length"
        class="info-msg mb-20"
      >
        {{ $t('userAddress.noAddress') }}
      </div>-->

    </transition>

    <div class="flex gap-20 align-initial wrap start" v-if="hasRadio">
      <label
        v-for="(value, key) in currentAddresses"
        :key="key"
        class="card p-15 address-card"
        :class="{active: selectedAddress === key}"
      >
        <input
          type="radio"
          name="user_address"
          :value="key"
          v-model="selectedAddress"
        />
        <span class="flex gap-10 mb-10 align-initial sided address-title">
            <span class="block bold">{{value.name}}</span>
            <span class="flex gap-10">
              <ajax-button
                class="outline-btn plr-10"
                :type="'button'"
                :text="$t('userAddress.edit')"
                color="primary"
                @clicked="$emit('editing', value)"
              />
              <ajax-button
                class="outline-btn plr-10"
                :type="'button'"
                :fetching-data="ajaxDeleting === value.id"
                :loading-text="$t('userAddress.deleting')"
                :text="$t('userAddress.delete')"
                color="primary"
                @clicked="deleting(value)"
              />
            </span>
          </span>

        <span v-html="formatAddress(value)"/>
        <span class="block mt-5">tel: {{value.phone}}</span>
      </label>

      <button
        class="address-btn card" type="button"
        @click.prevent="$emit('add-address')"
      >
          <span class="icon-wrap mb-10">
            <i
              class="icon plus-icon"
            />
          </span>

        {{ $t('addresses.addAddress') }}
      </button>

    </div>

    <div v-else class="flex wrap start align-initial gap-10">
      <div
        class="card p-20  mx-w-400x address-card"
        v-for="(value, index) in currentAddresses"
        :key="index"
      >
        <span class="flex gap-10 sided mb-10 address-title">

           <span class="bold block">{{value.name}}</span>

          <span class="flex gap-10">
            <ajax-button
              class="outline-btn plr-10"
              :type="'button'"
              :text="$t('userAddress.edit')"
              color="primary"
              @clicked="$emit('editing', value)"
            />
            <ajax-button
              class="outline-btn plr-10"
              :type="'button'"
              :fetching-data="ajaxDeleting === value.id"
              :loading-text="$t('userAddress.deleting')"
              :text="$t('userAddress.delete')"
              color="primary"
              @clicked="deleting(value)"
            />
          </span>
        </span>

        <span v-html="formatAddress(value)"/>
        <span class="block mt-5">tel: {{value.phone}}</span>

      </div>
    </div>
    <pagination
      ref="addressPagination"
      :total-page="totalPage"
      @fetching-data="fetchingData"
    />
  </div>
</template>

<script>
  import util from '~/mixin/util'
  import Pagination from '~/components/Pagination'
  import addressHelper from '~/mixin/addressHelper'
  import routeParamHelper from '~/mixin/routeParamHelper'
  import {mapGetters, mapActions} from 'vuex'
  import AjaxButton from "~/components/AjaxButton"
  import Spinner from "~/components/Spinner"

  export default {
    name: 'UserAddress',
    data() {
      return {
        ajaxDeleting: 0,
        selectedAddress: -1,
        selectedAddressObj: null
      }
    },
    props: {
      hasRadio: {
        type: Boolean,
        default: false
      }
    },
    watch: {
      selectedAddressObj(value) {
        if (this.currentAddresses.length) {

          const countryName = this.countryList[value.country]?.name
          const stateName = value.state ? this.countryList[value.country].states[value.state]?.name : ''
          this.$emit('selected-address', {...value, ...{countryTitle: countryName, stateTitle: stateName}})

        } else {

          this.$emit('selected-address', null)
        }
      },
      currentAddresses(value) {
        if (value.length) {
          if (this.hasRadio) {
            this.selectedAddress = 0
            this.selectedAddressObj = value[this.selectedAddress]
          }
        } else {

          this.selectedAddress = -1
          this.selectedAddressObj = null
        }
      },
      selectedAddress(value) {
        this.selectedAddressObj = this.currentAddresses[value]
      }
    },
    directives: {},
    components: {Spinner, AjaxButton, Pagination},
    mixins: [util, addressHelper, routeParamHelper],
    computed: {
      totalPage() {
        return this.allAddress?.last_page
      },
      currentAddresses() {
        return this.allAddress?.data || []
      },
      ...mapGetters('language', ['langCode']),
      ...mapGetters('resource', ['countryList', 'phoneList']),
      ...mapGetters('user', ['allAddress'])
    },
    methods: {
      async loadData() {
        this.$refs.addressPagination.routeParam()
      },
      ...mapActions('resource', ['setCountryList', 'setPhoneList']),
      ...mapActions('common', ['setToastMessage', 'setToastError', 'getRequest']),
      ...mapActions('user', ['userAddressAll', 'userAddressDelete', 'getUserToken']),
    },
    destroyed() {
    },
    async mounted() {
      if (!this.countryList || !this.phoneList) {
        this.fetchingAddressData = true

        const {data} = await this.getRequest({
          params: null,
          lang: this.langCode,
          api: 'countriesPhones'
        })

        this.setCountryList(data?.countries)
        this.setPhoneList(data?.phones)
        this.fetchingAddressData = false
      }

      await this.fetchingData()
    }
  }
</script>
